package com.homeplatform.service;

import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.AutheliaUsersFile;
import com.homeplatform.security.AutheliaUsersFile.Accounts;
import com.homeplatform.security.AutheliaUsersFile.UsersFileException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;

/**
 * "Forgot password?" for household members: a member who knows their username and the birthday an
 * admin stored for them can choose a new Home password (the one "Sign in with Home" asks for, kept
 * in Authelia's users file and shared by every app behind it) from the sign-in page.
 *
 * <p>A birthday is a weak secret (the owner chose it knowingly), so everything else is as tight as
 * it can be:
 * <ul>
 *   <li>Checked twice. Here: only ACTIVE accounts with role USER and a stored birthday, never
 *       admins, guests or sign-ups waiting for approval, whatever is stored. In the users file
 *       ({@link AutheliaUsersFile}): exactly one Home account uses the member's email, and it isn't
 *       disabled or in an admin group. The file is checked again under its lock as it's changed.</li>
 *   <li>Unknown username, ineligible account, no birthday, wrong birthday and a Home account that
 *       can't be changed this way all get the same answer, count against the same limits and take
 *       the same minimum time; the date is compared in constant time.</li>
 *   <li>Wrong tries are limited per username (5 in 15 minutes, then an hour's pause; 10 in a day,
 *       then a day's pause) and per client address (20 in 15 minutes, then an hour). The limits
 *       live in Redis and fail closed: no Redis, no resets.</li>
 *   <li>Every attempt is written to app_events (category "auth"; never the birthday or password).
 *       Admins get an in-app and phone notice when a reset succeeds, a username gets paused, or a
 *       matched birthday couldn't change the Home password.</li>
 * </ul>
 * Off unless the users file is configured (AUTHELIA_USERS_FILE). A reset doesn't end sessions
 * already open: Authelia's sessions live in its own Redis, and the app's JWTs aren't tied to a
 * password; see the admin notice.
 */
@Service
public class PasswordResetService {

    private static final Logger log = LoggerFactory.getLogger(PasswordResetService.class);

    static final String SOURCE = "PasswordReset";
    static final String CATEGORY = "auth";

    /** Authelia's password policy in ../home-sso (password_policy.standard.min_length). */
    public static final int MIN_PASSWORD_LENGTH = 8;
    /** Long enough for any passphrase; keeps an absurd request from being hashed. */
    static final int MAX_PASSWORD_LENGTH = 128;

    /** Wrong tries per username: this many in {@link #USER_WINDOW}, then {@link #USER_LOCKOUT}. */
    static final int USER_MAX = 5;
    static final Duration USER_WINDOW = Duration.ofMinutes(15);
    static final Duration USER_LOCKOUT = Duration.ofHours(1);
    /** And this many in a day, then a day's pause: at most ~10 guesses a day per account. */
    static final int USER_DAY_MAX = 10;
    static final Duration DAY = Duration.ofHours(24);
    /** Wrong tries per client address (behind Docker this may be every client's address at once). */
    static final int IP_MAX = 20;
    static final Duration IP_WINDOW = Duration.ofMinutes(15);
    static final Duration IP_LOCKOUT = Duration.ofHours(1);

    /** The one answer for every kind of no-match, so it can't tell anyone which kind it was. */
    public static final String NO_MATCH = "That didn't match. Check your username and birthday, or ask Bryan.";

    /** Compared against when there's no stored birthday to compare, so every path does the same work. */
    private static final LocalDate NOTHING_STORED = LocalDate.of(1, 1, 1);
    private static final LocalDate EARLIEST = LocalDate.of(1900, 1, 1);

    public enum Outcome { RESET, INVALID, NO_MATCH, THROTTLED, UNAVAILABLE, OFF }

    /**
     * @param error             what to show for {@link Outcome#INVALID} (input problems that don't
     *                          depend on any account)
     * @param retryAfterSeconds for {@link Outcome#THROTTLED}
     */
    public record Result(Outcome outcome, String error, long retryAfterSeconds) {
        static Result of(Outcome o) { return new Result(o, null, 0); }
    }

    /** A member's stored reset birthday, for the admin page. */
    public record Birthday(Long userId, LocalDate birthDate) {}

    private final UserRepository users;
    private final AutheliaUsersFile homeAccounts;
    private final LoginRateLimiter limiter;
    private final AppEventService events;
    private final NotificationService notifications;
    private final Duration minResponse;

    public PasswordResetService(UserRepository users, AutheliaUsersFile homeAccounts, LoginRateLimiter limiter,
                                AppEventService events, NotificationService notifications,
                                @Value("${app.security.password-reset.min-response-ms:500}") long minResponseMs) {
        this.users = users;
        this.homeAccounts = homeAccounts;
        this.limiter = limiter;
        this.events = events;
        this.notifications = notifications;
        this.minResponse = Duration.ofMillis(minResponseMs);
    }

    /** Whether "Forgot password?" is offered at all: only with the Home users file configured. */
    public boolean isEnabled() {
        return homeAccounts.isConfigured();
    }

    // ═══════════════════════════════════════════════════════════
    // The reset
    // ═══════════════════════════════════════════════════════════

    public Result reset(String rawUsername, LocalDate birthDate, String newPassword, String ip) {
        if (!isEnabled()) return Result.of(Outcome.OFF);
        // Input checks first: they don't depend on any account, so they reveal nothing.
        String username = rawUsername == null ? "" : rawUsername.trim();
        if (username.isEmpty() || birthDate == null) {
            return new Result(Outcome.INVALID, "Enter your username and birthday.", 0);
        }
        if (birthDate.isBefore(EARLIEST) || birthDate.isAfter(LocalDate.now())) {
            return new Result(Outcome.INVALID, "Enter your birthday.", 0);
        }
        String problem = passwordProblem(newPassword);
        if (problem != null) return new Result(Outcome.INVALID, problem, 0);

        Keys keys = new Keys(username, ip);
        String who = "'" + printable(username) + "' (from " + printable(ip) + ")";

        long ipWait = limiter.blockedForSeconds(keys.ip, IP_MAX);
        long userWait = limiter.blockedForSeconds(keys.user, USER_MAX);
        long dayWait = limiter.blockedForSeconds(keys.day, USER_DAY_MAX);
        if (ipWait < 0 || userWait < 0 || dayWait < 0) {
            events.log(CATEGORY, "ERROR", SOURCE, "Password reset unavailable for " + who + ": the rate limiter (Redis) can't be reached", null);
            return Result.of(Outcome.UNAVAILABLE);
        }
        long wait = Math.max(ipWait, Math.max(userWait, dayWait));
        if (wait > 0) {
            // One line a minute per username, so a flood of refused requests can't flood app_events.
            if (limiter.firstIn(keys.logged, Duration.ofMinutes(1))) {
                events.warn(CATEGORY, SOURCE, "Password reset refused for " + who + ": too many wrong tries, paused for "
                        + Math.max(1, wait / 60) + " more min (repeats within a minute aren't logged)");
            }
            return new Result(Outcome.THROTTLED, null, wait);
        }

        long started = System.nanoTime();
        try {
            return attempt(username, birthDate, newPassword, keys, who);
        } finally {
            padTo(started);
        }
    }

    /** What's wrong with {@code password} as a new Home password, or null when Authelia would take it. */
    public static String passwordProblem(String password) {
        if (password == null || password.isBlank() || password.codePointCount(0, password.length()) < MIN_PASSWORD_LENGTH) {
            return "Password must be at least " + MIN_PASSWORD_LENGTH + " characters.";
        }
        if (password.codePointCount(0, password.length()) > MAX_PASSWORD_LENGTH) {
            return "Password is too long. Use up to " + MAX_PASSWORD_LENGTH + " characters.";
        }
        if (password.chars().anyMatch(Character::isISOControl)) {
            return "Password can't contain tabs or line breaks.";
        }
        return null;
    }

    private Result attempt(String username, LocalDate birthDate, String newPassword, Keys keys, String who) {
        User user = users.findByUsernameIgnoreCase(username).orElse(null);
        String refusal = refusal(user);
        LocalDate stored = refusal == null ? user.getBirthDate() : NOTHING_STORED;
        // Always compare, in constant time, so the paths take the same work.
        boolean same = MessageDigest.isEqual(dateBytes(stored), dateBytes(birthDate));

        // The users file is read on every attempt, matched or not, so whether it's readable can't
        // say anything about the birthday.
        Accounts home;
        try {
            home = homeAccounts.read();
        } catch (UsersFileException e) {
            events.log(CATEGORY, "ERROR", SOURCE, "Password reset unavailable for " + who + ": the Home users file " + e.getMessage(), null);
            return Result.of(Outcome.UNAVAILABLE);
        }

        if (refusal == null && same) {
            String homeRefusal = home.refusal(user.getEmail());
            if (homeRefusal == null) {
                try {
                    AutheliaUsersFile.Changed changed = homeAccounts.setPassword(user.getEmail(), newPassword);
                    return succeeded(user, changed, keys, who);
                } catch (AutheliaUsersFile.Refused e) {
                    homeRefusal = e.getMessage(); // changed between the read and the write
                } catch (UsersFileException e) {
                    return writeFailed(user, e, who);
                }
            }
            refusal = "birthday matched, but " + homeRefusal;
            String name = nameOf(user);
            notifyAdmins(Severity.WARNING, name + "'s Home password wasn't reset",
                    "Someone gave " + name + "'s birthday on the sign-in page, but " + homeRefusal
                            + ", so nothing changed and they were told it didn't match.");
        }

        String why = refusal != null ? refusal : "birthday didn't match";
        long userCount = limiter.recordFailure(keys.user, USER_WINDOW, USER_MAX, USER_LOCKOUT);
        long dayCount = limiter.recordFailure(keys.day, DAY, USER_DAY_MAX, DAY);
        limiter.recordFailure(keys.ip, IP_WINDOW, IP_MAX, IP_LOCKOUT);
        String paused = dayCount == USER_DAY_MAX ? "a day" : userCount == USER_MAX ? "an hour" : null;

        events.warn(CATEGORY, SOURCE, "Password reset refused for " + who + ": " + why
                + (paused != null ? ". Resets for this username are now paused for " + paused : ""));
        if (paused != null && user != null) {
            String name = nameOf(user);
            notifyAdmins(Severity.WARNING, "Password resets paused for " + name,
                    "Someone entered the wrong birthday for " + name + "'s account too many times, so resetting their Home password is paused for "
                            + paused + ". If it wasn't " + name + ", you can clear the birthday in People.");
        }
        return Result.of(Outcome.NO_MATCH);
    }

    private Result succeeded(User user, AutheliaUsersFile.Changed changed, Keys keys, String who) {
        limiter.clear(keys.user);
        limiter.clear(keys.day);
        events.info(CATEGORY, SOURCE, "Home password reset with a birthday for " + who + ": Home account '"
                + changed.homeUsername() + "', previous users file kept as " + changed.backup());
        String name = nameOf(user);
        notifyAdmins(Severity.WARNING, name + " reset their Home password",
                name + " chose a new Home password from the sign-in page, using their birthday. It opens every app behind "
                        + "Sign in with Home. If that wasn't " + name + ", disable their Home account ('" + changed.homeUsername()
                        + "' in the users file) and clear their birthday in People. Devices already signed in stay signed in.");
        return Result.of(Outcome.RESET);
    }

    /** The birthday matched but the file couldn't be changed safely: nothing changed (or it was put back). */
    private Result writeFailed(User user, UsersFileException e, String who) {
        String name = nameOf(user);
        events.log(CATEGORY, "ERROR", SOURCE, "Home password reset for " + who + " failed: the Home users file " + e.getMessage(), null);
        log.error("Home password reset for '{}' failed: the users file {}", user.getUsername(), e.getMessage());
        notifyAdmins(e.signInAtRisk() ? Severity.CRITICAL : Severity.WARNING,
                e.signInAtRisk() ? "Home sign-in may be broken" : name + "'s Home password reset failed",
                name + " gave the right birthday to reset their Home password, but the Home users file " + e.getMessage() + ".");
        return Result.of(Outcome.UNAVAILABLE);
    }

    /** Why {@code user} can't reset by birthday, or null when they can (the reason goes to the log only). */
    static String refusal(User user) {
        if (user == null) return "no such account";
        if (user.getRole() != Role.USER) return "not a member account (" + user.getRole() + ")";
        if (user.getStatus() != AccountStatus.ACTIVE) return "account is " + user.getStatus();
        if (user.getBirthDate() == null) return "no birthday set";
        return null;
    }

    /** Every response that reached the check takes at least {@link #minResponse}. */
    private void padTo(long startedNanos) {
        long left = minResponse.toNanos() - (System.nanoTime() - startedNanos);
        if (left <= 0) return;
        try {
            Thread.sleep(left / 1_000_000, (int) (left % 1_000_000));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private void notifyAdmins(Severity severity, String title, String message) {
        for (User admin : users.findByRoleAndStatus(Role.ADMIN, AccountStatus.ACTIVE)) {
            try {
                notifications.createAndPush(admin.getId(), Category.SYSTEM, severity, title, message, "/users");
            } catch (Exception e) {
                log.warn("Couldn't notify admin {} about a password reset: {}", admin.getId(), e.getMessage());
            }
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Admin: the stored birthdays
    // ═══════════════════════════════════════════════════════════

    /** Every account with a stored birthday (admins only, AdminController). */
    public List<Birthday> birthdays() {
        return users.findAll().stream()
                .filter(u -> u.getBirthDate() != null)
                .map(u -> new Birthday(u.getId(), u.getBirthDate()))
                .toList();
    }

    /**
     * Sets or (with null) clears an account's reset birthday. Only members can have one set; any
     * account's can be cleared.
     *
     * @throws NoSuchElementException   no such user
     * @throws IllegalArgumentException not a member, or not a plausible birthday
     */
    @Transactional
    public Birthday setBirthday(Long userId, LocalDate birthDate, String byAdmin) {
        User user = users.findById(userId).orElseThrow(() -> new NoSuchElementException("User not found"));
        if (birthDate != null) {
            if (user.getRole() != Role.USER) {
                throw new IllegalArgumentException("Only members can reset their password with a birthday.");
            }
            if (birthDate.isBefore(EARLIEST) || birthDate.isAfter(LocalDate.now())) {
                throw new IllegalArgumentException("Enter a real birthday.");
            }
        }
        user.setBirthDate(birthDate);
        users.save(user);
        events.info(CATEGORY, SOURCE, printable(byAdmin) + (birthDate == null ? " cleared" : " set")
                + " the reset birthday for '" + user.getUsername() + "'");
        return new Birthday(user.getId(), user.getBirthDate());
    }

    // ═══════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════

    /** Redis keys for one attempt: the same for any username string, whether or not it exists. */
    private record Keys(String user, String day, String ip, String logged) {
        Keys(String username, String ip) {
            this(key("user", username), key("user-day", username), "reset-pw:ip:" + ip, key("logged", username));
        }

        private static String key(String kind, String username) {
            String u = username.toLowerCase(Locale.ROOT);
            return "reset-pw:" + kind + ":" + (u.length() > 100 ? u.substring(0, 100) : u);
        }
    }

    /** ISO yyyy-MM-dd: ten bytes for any date the checks above let through. */
    private static byte[] dateBytes(LocalDate d) {
        return String.format("%04d-%02d-%02d", d.getYear(), d.getMonthValue(), d.getDayOfMonth())
                .getBytes(StandardCharsets.US_ASCII);
    }

    private static String nameOf(User u) {
        return u.getDisplayName() != null && !u.getDisplayName().isBlank() ? u.getDisplayName() : u.getUsername();
    }

    /** Typed by whoever sent the request: no control characters (log lines), and not too long. */
    static String printable(String s) {
        if (s == null) return "?";
        String clean = s.replaceAll("\\p{Cntrl}", "?");
        return clean.length() > 100 ? clean.substring(0, 100) + "…" : clean;
    }
}
