package com.homeplatform.service;

import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.AutheliaUsersFile;
import com.homeplatform.security.AutheliaUsersFile.Account;
import com.homeplatform.security.AutheliaUsersFile.Accounts;
import com.homeplatform.security.AutheliaUsersFile.UsersFileException;
import com.homeplatform.service.PasswordResetService.Keys;
import com.homeplatform.service.PasswordResetService.Outcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The birthday reset: who qualifies (here and in the Home users file), that every kind of no-match
 * looks the same, the limits (counted before they're checked), and what reaches the log and the
 * admin. Made-up people and dates only.
 */
class PasswordResetServiceTest {

    private static final LocalDate PAT_BIRTHDAY = LocalDate.of(1987, 6, 15);
    private static final String IP = "10.9.8.7";
    private static final String NEW_PASSWORD = "brand-new-secret";

    private final List<User> people = new ArrayList<>();
    /** The Home (Authelia) accounts, by email. */
    private final List<Account> homePeople = new ArrayList<>();
    private UserRepository users;
    private AutheliaUsersFile home;
    private AppEventService events;
    private NotificationService notifications;
    private FakeRedis redis;
    private PasswordResetService service;

    @BeforeEach
    void setUp() throws Exception {
        users = mock(UserRepository.class);
        // As Postgres does it: upper() on both sides, with Unicode's case rules (ı → I, ſ → S).
        when(users.findByUsernameIgnoreCase(anyString())).thenAnswer(i -> people.stream()
                .filter(u -> u.getUsername().toUpperCase(Locale.ROOT).equals(i.<String>getArgument(0).toUpperCase(Locale.ROOT)))
                .findFirst());
        when(users.findById(anyLong())).thenAnswer(i -> people.stream()
                .filter(u -> u.getId().equals(i.getArgument(0))).findFirst());
        when(users.findAll()).thenAnswer(i -> List.copyOf(people));
        when(users.findByRoleAndStatus(any(), any())).thenAnswer(i -> people.stream()
                .filter(u -> u.getRole() == i.getArgument(0) && u.getStatus() == i.getArgument(1)).toList());
        when(users.save(any())).thenAnswer(i -> i.getArgument(0));
        home = mock(AutheliaUsersFile.class);
        when(home.isConfigured()).thenReturn(true);
        when(home.read()).thenAnswer(i -> new Accounts(List.copyOf(homePeople), Set.of("admin")));
        when(home.setPassword(anyString(), anyString())).thenAnswer(i -> new AutheliaUsersFile.Changed(
                homePeople.stream().filter(a -> a.emails().contains((String) i.getArgument(0))).findFirst().orElseThrow().username(),
                "users_database.yml.20260101-000000-000"));
        events = mock(AppEventService.class);
        notifications = mock(NotificationService.class);
        redis = new FakeRedis();
        service = new PasswordResetService(users, home, redis.limiter(), events, notifications, 0);

        person(1L, "sam", Role.ADMIN, AccountStatus.ACTIVE, LocalDate.of(1980, 1, 2));
        person(2L, "pat", Role.USER, AccountStatus.ACTIVE, PAT_BIRTHDAY).setDisplayName("Pat");
        person(3L, "visitor", Role.GUEST, AccountStatus.ACTIVE, PAT_BIRTHDAY);
        person(4L, "newbie", Role.USER, AccountStatus.PENDING_APPROVAL, PAT_BIRTHDAY);
        person(5L, "gone", Role.USER, AccountStatus.DISABLED, PAT_BIRTHDAY);
        person(6L, "nobday", Role.USER, AccountStatus.ACTIVE, null);
        homePeople.add(new Account("sam", List.of("sam@example.test"), List.of("admin", "family"), false));
        homePeople.add(new Account("pat", List.of("pat@example.test"), List.of("family"), false));
    }

    private User person(Long id, String username, Role role, AccountStatus status, LocalDate birthday) {
        User u = User.builder().id(id).username(username).email(username + "@example.test")
                .role(role).status(status).birthDate(birthday).build();
        people.add(u);
        return u;
    }

    private User get(String username) {
        return people.stream().filter(u -> u.getUsername().equals(username)).findFirst().orElseThrow();
    }

    private Outcome attempt(String username, LocalDate birthday) {
        return service.reset(username, birthday, NEW_PASSWORD, IP).outcome();
    }

    private static String userKey(String username) {
        return Keys.of(username).user();
    }

    private static String dayKey(String username) {
        return Keys.of(username).day();
    }

    /** Every text the service wrote to app_events. */
    private List<String> logged() {
        List<String> all = new ArrayList<>();
        ArgumentCaptor<String> text = ArgumentCaptor.forClass(String.class);
        verify(events, atLeast(0)).info(anyString(), anyString(), text.capture());
        all.addAll(text.getAllValues());
        text = ArgumentCaptor.forClass(String.class);
        verify(events, atLeast(0)).warn(anyString(), anyString(), text.capture());
        all.addAll(text.getAllValues());
        ArgumentCaptor<String> msg = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> details = ArgumentCaptor.forClass(String.class);
        verify(events, atLeast(0)).log(anyString(), anyString(), anyString(), msg.capture(), details.capture());
        all.addAll(msg.getAllValues());
        details.getAllValues().stream().filter(d -> d != null).forEach(all::add);
        return all;
    }

    /** Titles of every admin notice sent. */
    private List<String> notices() {
        ArgumentCaptor<String> title = ArgumentCaptor.forClass(String.class);
        verify(notifications, atLeast(0)).createAndPush(anyLong(), any(), any(), title.capture(), anyString(), anyString());
        return title.getAllValues();
    }

    @Test
    @DisplayName("a member with the right birthday gets the new Home password, and admins hear it opens every Home app")
    void success() throws Exception {
        assertEquals(Outcome.RESET, attempt("PAT", PAT_BIRTHDAY), "username is case-insensitive");

        verify(home).setPassword("pat@example.test", NEW_PASSWORD);
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING),
                eq("Pat reset their Home password"), contains("opens every app behind Sign in with Home"), eq("/users"));
        verifyNoMoreInteractions(notifications);
        assertTrue(logged().stream().anyMatch(m -> m.contains("Home password reset with a birthday for 'PAT' (from 10.9.8.7): Home account 'pat'")));
        assertNull(redis.values.get(userKey("pat")), "this try was counted, then cleared");
        assertNull(redis.values.get(dayKey("pat")));
    }

    @Test
    @DisplayName("unknown, admin, guest, pending, disabled, no birthday and wrong birthday are all the same no-match")
    void everyIneligibleCaseIsTheSame() throws Exception {
        String[][] cases = {
                {"nobody", "no such account"},
                {"sam", "not a member account (ADMIN)"},
                {"visitor", "not a member account (GUEST)"},
                {"newbie", "account is PENDING_APPROVAL"},
                {"gone", "account is DISABLED"},
                {"nobday", "no birthday set"},
        };
        for (String[] c : cases) {
            // Even with the very date stored on the account (the admin's own for "sam").
            LocalDate tried = c[0].equals("sam") ? LocalDate.of(1980, 1, 2) : PAT_BIRTHDAY;
            assertEquals(PasswordResetService.Result.of(Outcome.NO_MATCH), service.reset(c[0], tried, NEW_PASSWORD, IP), c[0]);
            assertTrue(logged().stream().anyMatch(m -> m.contains("'" + c[0] + "'") && m.contains(c[1])), c[1]);
        }
        verifyNoInteractions(notifications);
        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.plusDays(1)));
        assertTrue(logged().stream().anyMatch(m -> m.contains("'pat'") && m.contains("birthday didn't match")));

        verify(home, never()).setPassword(any(), any());
        assertEquals(List.of("Wrong birthday for Pat"), notices(), "only the real member's wrong birthday is reported");
        // Every one of them counted against its username, the unknown one included.
        for (String u : new String[]{"nobody", "sam", "visitor", "newbie", "gone", "nobday", "pat"}) {
            assertEquals("1", redis.values.get(userKey(u)), u);
        }
    }

    @Test
    @DisplayName("the right birthday but a Home account that can't be reset (admin group, missing, disabled): the same no-match, counted, and the admin is told")
    void homeSideRefusals() throws Exception {
        record Case(Account homeAccount, String reason) {}
        List<Case> cases = List.of(
                new Case(new Account("pat", List.of("pat@example.test"), List.of("family", "admin"), false), "is in the 'admin' group"),
                new Case(null, "no Home account uses their email"),
                new Case(new Account("pat", List.of("pat@example.test"), List.of("family"), true), "is disabled"));
        int n = 0;
        for (Case c : cases) {
            homePeople.removeIf(a -> a.username().equals("pat"));
            if (c.homeAccount() != null) homePeople.add(c.homeAccount());
            assertEquals(PasswordResetService.Result.of(Outcome.NO_MATCH), service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, IP), c.reason());
            n++;
            assertEquals(String.valueOf(n), redis.values.get(userKey("pat")), "counted like a wrong birthday");
            String reason = c.reason();
            assertTrue(logged().stream().anyMatch(m -> m.contains("'pat'") && m.contains("birthday matched, but") && m.contains(reason)), reason);
            verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING),
                    eq("Pat's Home password wasn't reset"), contains(reason), eq("/users"));
        }
        verify(home, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("a Home account that changed between the check and the write (now refused) is a no-match too")
    void refusedAtWrite() throws Exception {
        doThrow(new AutheliaUsersFile.Refused("their Home account 'pat' is in the 'admin' group"))
                .when(home).setPassword(anyString(), anyString());
        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY));
        assertEquals("1", redis.values.get(userKey("pat")));
    }

    @Test
    @DisplayName("an unreadable users file makes resets unavailable for everyone, matched or not, before anything is counted")
    void usersFileUnreadable() throws Exception {
        when(home.read()).thenThrow(new UsersFileException("isn't there (/authelia/users_database.yml)"));
        assertEquals(Outcome.UNAVAILABLE, attempt("pat", PAT_BIRTHDAY));
        assertEquals(Outcome.UNAVAILABLE, attempt("pat", PAT_BIRTHDAY.plusDays(1)));
        assertEquals(Outcome.UNAVAILABLE, attempt("nobody", PAT_BIRTHDAY));
        assertTrue(redis.values.keySet().stream().noneMatch(k -> k.startsWith("reset-pw:ip") || k.startsWith("reset-pw:user")),
                () -> "nothing counted: " + redis.values.keySet());
        verify(users, never()).findByUsernameIgnoreCase(any());
        verify(home, never()).setPassword(any(), any());
        assertEquals(1, logged().stream().filter(m -> m.contains("the Home users file isn't there")).count(), "logged once a minute");
    }

    @Test
    @DisplayName("a failed write is unavailable (nothing changed), not a wrong try, and the admin is told; a file left broken is critical")
    void writeFails() throws Exception {
        doThrow(new UsersFileException("didn't read back as written, so the previous file was put back from x; nothing changed"))
                .doThrow(new UsersFileException("didn't read back as written, and putting the previous file back failed too", true, null))
                .when(home).setPassword(anyString(), anyString());
        assertEquals(Outcome.UNAVAILABLE, attempt("pat", PAT_BIRTHDAY));
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING),
                eq("Pat's Home password reset failed"), contains("was put back"), eq("/users"));
        assertEquals(Outcome.UNAVAILABLE, attempt("pat", PAT_BIRTHDAY));
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.CRITICAL),
                eq("Home sign-in may be broken"), contains("failed too"), eq("/users"));
        assertNull(redis.values.get(userKey("pat")), "the right birthday gives its count back");
        assertNull(redis.values.get(dayKey("pat")));
    }

    @Test
    @DisplayName("without a Home users file configured, it's off: nothing is read or counted")
    void off() throws Exception {
        when(home.isConfigured()).thenReturn(false);
        assertFalse(service.isEnabled());
        assertEquals(Outcome.OFF, attempt("pat", PAT_BIRTHDAY));
        verify(home, never()).read();
        verify(users, never()).findByUsernameIgnoreCase(any());
        assertTrue(redis.values.isEmpty());
    }

    @Test
    @DisplayName("five wrong tries pause the username for an hour, even for the right birthday, and tell the admins")
    void fiveWrongTriesPause() throws Exception {
        for (int i = 0; i < 4; i++) assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusYears(1)));
        assertEquals(List.of("Wrong birthday for Pat"), notices(), "the first wrong one of the day, and only that");
        assertEquals(Duration.ofMinutes(15), redis.ttl(userKey("pat")));

        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusYears(1)));
        assertEquals(Duration.ofHours(1), redis.ttl(userKey("pat")), "the fifth starts a longer pause");
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING),
                eq("Password resets paused for Pat"), contains("an hour"), eq("/users"));

        var blocked = service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, IP);
        assertEquals(Outcome.THROTTLED, blocked.outcome());
        assertEquals(3600, blocked.retryAfterSeconds());
        verify(home, never()).setPassword(any(), any());

        // An hour later the right birthday works, and clears the counts.
        redis.pass(userKey("pat"));
        assertEquals(Outcome.RESET, attempt("pat", PAT_BIRTHDAY));
        assertNull(redis.values.get(dayKey("pat")));
    }

    @Test
    @DisplayName("a member who mistypes four times and gets it right on the fifth isn't left paused")
    void mistypesThenRight() {
        for (int i = 0; i < 4; i++) assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusDays(i + 1)));
        // The fifth is counted first (and sets the hour's pause), then succeeds and clears it.
        assertEquals(Outcome.RESET, attempt("pat", PAT_BIRTHDAY));
        assertNull(redis.values.get(userKey("pat")));
        assertNull(redis.values.get(dayKey("pat")));
        assertEquals(Outcome.RESET, attempt("pat", PAT_BIRTHDAY), "and can go again straight away");
    }

    @Test
    @DisplayName("hammering a paused account doesn't make its pause longer, or turn the hour into a day")
    void hammeringDoesNotExtend() {
        for (int i = 0; i < 5; i++) attempt("pat", PAT_BIRTHDAY.minusYears(3));
        assertEquals(Duration.ofHours(1), redis.ttl(userKey("pat")));
        for (int i = 0; i < 12; i++) {
            assertEquals(Outcome.THROTTLED, service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, "10.0.0." + i).outcome());
        }
        assertEquals("17", redis.values.get(userKey("pat")), "still counted");
        assertEquals(Duration.ofHours(1), redis.ttl(userKey("pat")), "but the pause still ends an hour after the fifth");
        assertEquals("5", redis.values.get(dayKey("pat")), "and paused tries don't reach the day's count");
        assertEquals(Duration.ofHours(24), redis.ttl(dayKey("pat")));
    }

    @Test
    @DisplayName("an unknown username is paused after five tries too, so pausing reveals nothing, and no admin is bothered")
    void unknownUsernamePausedAlike() {
        for (int i = 0; i < 5; i++) assertEquals(Outcome.NO_MATCH, attempt("nobody", PAT_BIRTHDAY));
        assertEquals(Outcome.THROTTLED, attempt("nobody", PAT_BIRTHDAY));
        assertEquals(Duration.ofHours(1), redis.ttl(userKey("nobody")));
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("ten wrong tries in a day pause the username for a day")
    void tenADay() {
        for (int i = 0; i < 5; i++) attempt("pat", PAT_BIRTHDAY.minusDays(i + 1));
        redis.pass(userKey("pat")); // the hour's pause runs out
        for (int i = 0; i < 4; i++) attempt("pat", PAT_BIRTHDAY.minusDays(i + 10));
        assertEquals(Duration.ofHours(24), redis.ttl(dayKey("pat")), "window from the first try");
        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusDays(20)));
        assertEquals(Duration.ofHours(24), redis.ttl(dayKey("pat")), "the tenth starts a fresh day's pause");

        redis.pass(userKey("pat"));
        var blocked = service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, IP);
        assertEquals(Outcome.THROTTLED, blocked.outcome());
        assertEquals(24 * 3600, blocked.retryAfterSeconds());
        verify(notifications).createAndPush(eq(1L), any(), any(), eq("Password resets paused for Pat"), contains("a day"), eq("/users"));
    }

    @Test
    @DisplayName("twenty tries from one address pause every username from it, and the admin hears resets are paused for everyone")
    void perAddress() {
        for (int i = 0; i < 20; i++) attempt("guess" + i, PAT_BIRTHDAY);
        assertEquals(Outcome.THROTTLED, attempt("pat", PAT_BIRTHDAY));
        assertNull(redis.values.get(userKey("pat")), "turned away before any per-username key");
        assertTrue(notices().contains("Password resets paused for everyone"));
        assertEquals(Outcome.RESET, service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, "10.1.1.1").outcome());
    }

    @Test
    @DisplayName("twenty tries on ONE made-up username (fifteen of them refused by its own pause) still tell the admin everyone is paused")
    void addressPauseNoticeForOneMadeUpName() {
        for (int i = 0; i < 20; i++) attempt("made-up", PAT_BIRTHDAY);
        assertEquals("20", redis.values.get("reset-pw:ip:" + IP));
        assertEquals(List.of("Password resets paused for everyone"), notices(), "unknown names get no other notice");
        assertTrue(logged().stream().anyMatch(m -> m.contains("Password resets paused for an hour for every username")));
        assertEquals(Outcome.THROTTLED, attempt("pat", PAT_BIRTHDAY));
        assertEquals(1, notices().size(), "sent once, when the count fills");
    }

    @Test
    @DisplayName("an admin lifts a member's pause by clearing their counts; the per-address pause is left alone")
    void clearWrongTries() {
        for (int i = 0; i < 5; i++) attempt("pat", PAT_BIRTHDAY.minusYears(1));
        assertEquals(Outcome.THROTTLED, service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, "10.2.2.2").outcome());

        service.clearWrongTries(2L, "sam");
        assertNull(redis.values.get(userKey("pat")));
        assertNull(redis.values.get(dayKey("pat")));
        assertNotNull(redis.values.get("reset-pw:ip:" + IP));
        assertTrue(logged().stream().anyMatch(m -> m.equals("sam cleared the password reset tries for 'pat'")));
        assertEquals(Outcome.RESET, service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, "10.2.2.2").outcome());
        assertThrows(NoSuchElementException.class, () -> service.clearWrongTries(99L, "sam"));
    }

    /** Runs {@code n} resets at once (released together) and counts the outcomes. */
    private Map<Outcome, Integer> burst(int n, java.util.function.IntFunction<String> username,
                                        java.util.function.IntFunction<LocalDate> birthday) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(n);
        CountDownLatch ready = new CountDownLatch(n);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Outcome>> futures = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            int k = i;
            futures.add(pool.submit(() -> {
                ready.countDown();
                go.await();
                return service.reset(username.apply(k), birthday.apply(k), NEW_PASSWORD, IP).outcome();
            }));
        }
        assertTrue(ready.await(10, TimeUnit.SECONDS));
        go.countDown();
        Map<Outcome, Integer> counts = new EnumMap<>(Outcome.class);
        for (Future<Outcome> f : futures) counts.merge(f.get(30, TimeUnit.SECONDS), 1, Integer::sum);
        pool.shutdown();
        return counts;
    }

    @Test
    @DisplayName("fifty guesses released at once: no more than five are ever checked against the birthday")
    void concurrentGuessesPerUsername() throws Exception {
        Map<Outcome, Integer> counts = burst(50, i -> "pat", i -> PAT_BIRTHDAY.minusDays(i + 1));
        int evaluated = counts.getOrDefault(Outcome.NO_MATCH, 0) + counts.getOrDefault(Outcome.RESET, 0);
        assertTrue(evaluated <= PasswordResetService.USER_MAX, counts::toString);
        assertEquals(PasswordResetService.USER_MAX, evaluated, counts::toString);
        assertEquals(50 - PasswordResetService.USER_MAX, counts.get(Outcome.THROTTLED), counts::toString);
    }

    @Test
    @DisplayName("fifty made-up usernames released at once from one address: no more than twenty are checked")
    void concurrentGuessesPerAddress() throws Exception {
        Map<Outcome, Integer> counts = burst(50, i -> "made-up-" + i, i -> PAT_BIRTHDAY);
        int evaluated = counts.getOrDefault(Outcome.NO_MATCH, 0) + counts.getOrDefault(Outcome.RESET, 0);
        assertEquals(PasswordResetService.IP_MAX, evaluated, counts::toString);
        long perUsernameKeys = redis.values.keySet().stream().filter(k -> k.startsWith("reset-pw:user:")).count();
        assertEquals(PasswordResetService.IP_MAX, perUsernameKeys, "turned-away names leave no keys");
    }

    @Test
    @DisplayName("look-alike letters (ı, ſ, a space) get the plain no-match without reaching the account or any counter")
    void lookAlikeUsernames() throws Exception {
        person(7L, "kim", Role.USER, AccountStatus.ACTIVE, PAT_BIRTHDAY).setDisplayName("Kim");
        homePeople.add(new Account("kim", List.of("kim@example.test"), List.of("family"), false));
        for (String odd : new String[]{"kım", "ſam", "pa t", "pat ", "ｐat"}) {
            assertEquals(PasswordResetService.Result.of(Outcome.NO_MATCH), service.reset(odd, PAT_BIRTHDAY, NEW_PASSWORD, IP), odd);
        }
        verify(users, never()).findByUsernameIgnoreCase(any());
        assertTrue(redis.values.keySet().stream().noneMatch(k -> k.startsWith("reset-pw:ip") || k.startsWith("reset-pw:user")),
                () -> "nothing counted: " + redis.values.keySet());
        assertEquals(1, logged().stream().filter(m -> m.contains("isn't plain letters")).count(), "logged once a minute");
        verify(home, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("every spelling of a real username shares one counter: the account's own name keys it")
    void caseVariantsShareACounter() {
        get("pat").setUsername("Pat");
        for (String spelling : new String[]{"pat", "PAT", "pAt", "Pat", "PAt"}) {
            assertEquals(Outcome.NO_MATCH, attempt(spelling, PAT_BIRTHDAY.minusYears(1)), spelling);
        }
        assertEquals("5", redis.values.get(userKey("Pat")));
        assertEquals(Outcome.THROTTLED, attempt("paT", PAT_BIRTHDAY));
    }

    @Test
    @DisplayName("Redis keys stay short whatever is typed, and don't hold the name")
    void shortKeys() {
        attempt("x".repeat(100), PAT_BIRTHDAY);
        attempt("pat", PAT_BIRTHDAY.minusDays(1));
        int longest = "reset-pw:user-day:".length() + 24;
        for (String k : redis.values.keySet()) {
            if (k.startsWith("reset-pw:ip:")) continue;
            assertTrue(k.length() <= longest, k);
            assertFalse(k.contains("xxxx") || k.endsWith(":pat"), k);
        }
        assertEquals(Keys.of("PAT"), Keys.of("pat"));
    }

    @Test
    @DisplayName("the first wrong birthday for a member each day reaches the admin; more that day don't; unknown names never do")
    void wrongBirthdayNotice() {
        person(7L, "kim", Role.USER, AccountStatus.ACTIVE, LocalDate.of(1993, 3, 3)).setDisplayName("Kim");
        attempt("pat", PAT_BIRTHDAY.minusDays(1));
        attempt("pat", PAT_BIRTHDAY.minusDays(2));
        attempt("kim", PAT_BIRTHDAY);
        attempt("nobody", PAT_BIRTHDAY);
        attempt("sam", PAT_BIRTHDAY);
        assertEquals(List.of("Wrong birthday for Pat", "Wrong birthday for Kim"), notices());
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING), eq("Wrong birthday for Pat"),
                contains("you can clear their birthday in People"), eq("/users"));

        redis.pass(Keys.of("pat").noticed()); // a day later
        attempt("pat", PAT_BIRTHDAY.minusDays(3));
        assertEquals(2, notices().stream().filter("Wrong birthday for Pat"::equals).count());
    }

    @Test
    @DisplayName("with Redis unreachable, resets stop instead of running unlimited")
    void failsClosed() throws Exception {
        redis.down = true;
        assertEquals(Outcome.UNAVAILABLE, attempt("pat", PAT_BIRTHDAY));
        verify(users, never()).findByUsernameIgnoreCase(any());
        verify(home, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("refused requests while paused are logged once a minute, not once each")
    void throttledLogCoalesced() {
        for (int i = 0; i < 5; i++) attempt("pat", PAT_BIRTHDAY.minusYears(2));
        for (int i = 0; i < 12; i++) attempt("pat", PAT_BIRTHDAY);
        long pausedLines = logged().stream().filter(m -> m.contains("too many tries")).count();
        assertEquals(1, pausedLines);
    }

    @Test
    @DisplayName("bad input is refused before any lookup and doesn't count as a try; passwords follow Home's 8-character rule")
    void invalidInput() throws Exception {
        assertEquals(Outcome.INVALID, service.reset(" ", PAT_BIRTHDAY, NEW_PASSWORD, IP).outcome());
        assertEquals(Outcome.INVALID, service.reset("pat", null, NEW_PASSWORD, IP).outcome());
        assertEquals(Outcome.INVALID, service.reset("pat", LocalDate.now().plusDays(1), NEW_PASSWORD, IP).outcome());
        var shortPw = service.reset("pat", PAT_BIRTHDAY, "seven77", IP);
        assertEquals(Outcome.INVALID, shortPw.outcome());
        assertEquals("Password must be at least 8 characters.", shortPw.error());
        assertEquals(Outcome.INVALID, service.reset("pat", PAT_BIRTHDAY, "        ", IP).outcome());
        assertEquals(Outcome.INVALID, service.reset("pat", PAT_BIRTHDAY, "x".repeat(129), IP).outcome());
        assertEquals("Password can't contain tabs or line breaks.", service.reset("pat", PAT_BIRTHDAY, "two\nlines here", IP).error());
        verify(users, never()).findByUsernameIgnoreCase(any());
        verify(home, never()).read();
        assertTrue(redis.values.isEmpty());

        assertNull(PasswordResetService.passwordProblem("eight888"));
        assertNull(PasswordResetService.passwordProblem("x".repeat(128)));
        assertNull(PasswordResetService.passwordProblem("pässwörd"), "letters beyond ASCII count once each");
    }

    @Test
    @DisplayName("the birthday and the password never reach the log or a notice, whatever happens")
    void nothingSecretLogged() throws Exception {
        attempt("pat", PAT_BIRTHDAY.plusDays(3));
        attempt("nobody", PAT_BIRTHDAY);
        attempt("pat", PAT_BIRTHDAY);
        homePeople.removeIf(a -> a.username().equals("pat"));
        attempt("pat", PAT_BIRTHDAY);
        service.setBirthday(6L, LocalDate.of(1999, 12, 31), "sam");
        List<String> texts = new ArrayList<>(logged());
        ArgumentCaptor<String> notice = ArgumentCaptor.forClass(String.class);
        verify(notifications, atLeast(0)).createAndPush(anyLong(), any(), any(), anyString(), notice.capture(), anyString());
        texts.addAll(notice.getAllValues());
        assertFalse(texts.isEmpty());
        for (String m : texts) {
            for (String secret : new String[]{"1987", "06-15", "6/15", "June", "1999", "12-31", NEW_PASSWORD}) {
                assertFalse(m.contains(secret), () -> "'" + secret + "' in: " + m);
            }
        }
    }

    @Test
    @DisplayName("every answer from the account lookup on takes at least the minimum time, so timing can't tell the kinds apart")
    void minimumTime() {
        service = new PasswordResetService(users, home, redis.limiter(), events, notifications, 120);
        homePeople.removeIf(a -> a.username().equals("pat"));
        homePeople.add(new Account("pat", List.of("pat@example.test"), List.of("admin"), false));
        for (String[] t : new String[][]{{"nobody", "x"}, {"sam", "x"}, {"nobday", "x"}, {"pat", "wrong"}, {"pat", "right, but Home refuses"}}) {
            long t0 = System.nanoTime();
            LocalDate tried = t[1].startsWith("right") ? PAT_BIRTHDAY : PAT_BIRTHDAY.plusDays(1);
            assertEquals(Outcome.NO_MATCH, attempt(t[0], tried));
            long ms = (System.nanoTime() - t0) / 1_000_000;
            assertTrue(ms >= 120, t[0] + " took " + ms + " ms");
        }
    }

    @Test
    @DisplayName("admins set birthdays for members only, can clear anyone's, and the list has every stored one")
    void adminBirthdays() {
        var set = service.setBirthday(6L, LocalDate.of(1995, 2, 3), "sam");
        assertEquals(LocalDate.of(1995, 2, 3), set.birthDate());
        assertEquals(LocalDate.of(1995, 2, 3), get("nobday").getBirthDate());

        assertThrows(IllegalArgumentException.class, () -> service.setBirthday(1L, LocalDate.of(1980, 1, 2), "sam"));
        assertThrows(IllegalArgumentException.class, () -> service.setBirthday(3L, LocalDate.of(1980, 1, 2), "sam"));
        assertThrows(IllegalArgumentException.class, () -> service.setBirthday(2L, LocalDate.now().plusDays(1), "sam"));
        assertThrows(NoSuchElementException.class, () -> service.setBirthday(99L, LocalDate.of(1980, 1, 2), "sam"));

        // Stored on accounts that can't use it (made before a role change, say): clearable.
        service.setBirthday(1L, null, "sam");
        assertNull(get("sam").getBirthDate());

        assertEquals(List.of(2L, 3L, 4L, 5L, 6L), service.birthdays().stream().map(PasswordResetService.Birthday::userId).toList());
    }

    @Test
    @DisplayName("refusal reasons, for the log")
    void refusalReasons() {
        assertNull(PasswordResetService.refusal(get("pat")));
        assertEquals("no such account", PasswordResetService.refusal(null));
        get("pat").setStatus(AccountStatus.EXPIRED);
        assertEquals("account is EXPIRED", PasswordResetService.refusal(get("pat")));
    }

    @Test
    @DisplayName("typed text goes into the log without control characters")
    void printable() {
        assertEquals("evil?? fake line", PasswordResetService.printable("evil\r\n fake line"));
        assertEquals(101, PasswordResetService.printable("a".repeat(500)).length());
    }
}
