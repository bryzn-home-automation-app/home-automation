package com.homeplatform.service;

import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.service.PasswordResetService.Outcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The birthday reset: who qualifies, that every kind of no-match looks the same, the limits, and
 * what reaches the log. Made-up people and dates only.
 */
class PasswordResetServiceTest {

    private static final LocalDate PAT_BIRTHDAY = LocalDate.of(1987, 6, 15);
    private static final String IP = "10.9.8.7";
    private static final String NEW_PASSWORD = "brand-new-secret";

    private final List<User> people = new ArrayList<>();
    private UserRepository users;
    private UserService userService;
    private AppEventService events;
    private NotificationService notifications;
    private FakeRedis redis;
    private PasswordResetService service;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        when(users.findByUsernameIgnoreCase(anyString())).thenAnswer(i -> people.stream()
                .filter(u -> u.getUsername().equalsIgnoreCase(i.getArgument(0))).findFirst());
        when(users.findById(anyLong())).thenAnswer(i -> people.stream()
                .filter(u -> u.getId().equals(i.getArgument(0))).findFirst());
        when(users.findAll()).thenAnswer(i -> List.copyOf(people));
        when(users.findByRoleAndStatus(any(), any())).thenAnswer(i -> people.stream()
                .filter(u -> u.getRole() == i.getArgument(0) && u.getStatus() == i.getArgument(1)).toList());
        when(users.save(any())).thenAnswer(i -> i.getArgument(0));
        userService = mock(UserService.class);
        events = mock(AppEventService.class);
        notifications = mock(NotificationService.class);
        redis = new FakeRedis();
        service = new PasswordResetService(users, userService, redis.limiter(), events, notifications, 0);

        person(1L, "sam", Role.ADMIN, AccountStatus.ACTIVE, LocalDate.of(1980, 1, 2));
        person(2L, "pat", Role.USER, AccountStatus.ACTIVE, PAT_BIRTHDAY).setDisplayName("Pat");
        person(3L, "visitor", Role.GUEST, AccountStatus.ACTIVE, PAT_BIRTHDAY);
        person(4L, "newbie", Role.USER, AccountStatus.PENDING_APPROVAL, PAT_BIRTHDAY);
        person(5L, "gone", Role.USER, AccountStatus.DISABLED, PAT_BIRTHDAY);
        person(6L, "nobday", Role.USER, AccountStatus.ACTIVE, null);
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

    @Test
    @DisplayName("a member with the right birthday gets the new password, hashed by UserService, and admins hear about it")
    void success() {
        assertEquals(Outcome.RESET, attempt("PAT", PAT_BIRTHDAY), "username is case-insensitive");

        verify(userService).setPassword(get("pat"), NEW_PASSWORD);
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING),
                eq("Pat reset their password"), contains("using their birthday"), eq("/users"));
        verifyNoMoreInteractions(notifications);
        assertTrue(logged().stream().anyMatch(m -> m.contains("Password reset with a birthday for 'PAT' (from 10.9.8.7)")));
    }

    @Test
    @DisplayName("unknown, admin, guest, pending, disabled, no birthday and wrong birthday are all the same no-match")
    void everyIneligibleCaseIsTheSame() {
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
        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.plusDays(1)));
        assertTrue(logged().stream().anyMatch(m -> m.contains("'pat'") && m.contains("birthday didn't match")));

        verify(userService, never()).setPassword(any(), any());
        verifyNoInteractions(notifications);
        // Every one of them counted against its username, the unknown one included.
        for (String u : new String[]{"nobody", "sam", "visitor", "newbie", "gone", "nobday", "pat"}) {
            assertEquals("1", redis.values.get("reset-pw:user:" + u), u);
        }
    }

    @Test
    @DisplayName("five wrong tries pause the username for an hour, even for the right birthday, and tell the admins")
    void fiveWrongTriesPause() {
        for (int i = 0; i < 4; i++) assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusYears(1)));
        verifyNoInteractions(notifications);
        assertEquals(Duration.ofMinutes(15), redis.ttl("reset-pw:user:pat"));

        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusYears(1)));
        assertEquals(Duration.ofHours(1), redis.ttl("reset-pw:user:pat"), "the fifth starts a longer pause");
        verify(notifications).createAndPush(eq(1L), eq(Category.SYSTEM), eq(Severity.WARNING),
                eq("Password resets paused for Pat"), contains("an hour"), eq("/users"));

        var blocked = service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, IP);
        assertEquals(Outcome.THROTTLED, blocked.outcome());
        assertEquals(3600, blocked.retryAfterSeconds());
        verify(userService, never()).setPassword(any(), any());

        // An hour later the right birthday works, and clears the counts.
        redis.pass("reset-pw:user:pat");
        assertEquals(Outcome.RESET, attempt("pat", PAT_BIRTHDAY));
        assertNull(redis.values.get("reset-pw:user-day:pat"));
    }

    @Test
    @DisplayName("an unknown username is paused after five tries too, so pausing reveals nothing, and no admin is bothered")
    void unknownUsernamePausedAlike() {
        for (int i = 0; i < 5; i++) assertEquals(Outcome.NO_MATCH, attempt("nobody", PAT_BIRTHDAY));
        assertEquals(Outcome.THROTTLED, attempt("nobody", PAT_BIRTHDAY));
        assertEquals(Duration.ofHours(1), redis.ttl("reset-pw:user:nobody"));
        verifyNoInteractions(notifications);
    }

    @Test
    @DisplayName("ten wrong tries in a day pause the username for a day")
    void tenADay() {
        for (int i = 0; i < 5; i++) attempt("pat", PAT_BIRTHDAY.minusDays(i + 1));
        redis.pass("reset-pw:user:pat"); // the hour's pause runs out
        for (int i = 0; i < 4; i++) attempt("pat", PAT_BIRTHDAY.minusDays(i + 10));
        assertEquals(Duration.ofHours(24), redis.ttl("reset-pw:user-day:pat"), "window from the first try");
        assertEquals(Outcome.NO_MATCH, attempt("pat", PAT_BIRTHDAY.minusDays(20)));
        assertEquals(Duration.ofHours(24), redis.ttl("reset-pw:user-day:pat"), "the tenth starts a fresh day's pause");

        redis.pass("reset-pw:user:pat");
        var blocked = service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, IP);
        assertEquals(Outcome.THROTTLED, blocked.outcome());
        assertEquals(24 * 3600, blocked.retryAfterSeconds());
        verify(notifications).createAndPush(eq(1L), any(), any(), eq("Password resets paused for Pat"), contains("a day"), eq("/users"));
    }

    @Test
    @DisplayName("twenty wrong tries from one address pause every username from it")
    void perAddress() {
        for (int i = 0; i < 20; i++) attempt("guess" + i, PAT_BIRTHDAY);
        assertEquals(Outcome.THROTTLED, attempt("pat", PAT_BIRTHDAY));
        assertEquals(Outcome.RESET, service.reset("pat", PAT_BIRTHDAY, NEW_PASSWORD, "10.1.1.1").outcome());
    }

    @Test
    @DisplayName("with Redis unreachable, resets stop instead of running unlimited")
    void failsClosed() {
        redis.down = true;
        assertEquals(Outcome.UNAVAILABLE, attempt("pat", PAT_BIRTHDAY));
        verify(users, never()).findByUsernameIgnoreCase(any());
        verify(userService, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("refused requests while paused are logged once a minute, not once each")
    void throttledLogCoalesced() {
        for (int i = 0; i < 5; i++) attempt("pat", PAT_BIRTHDAY.minusYears(2));
        for (int i = 0; i < 30; i++) attempt("pat", PAT_BIRTHDAY);
        long pausedLines = logged().stream().filter(m -> m.contains("too many wrong tries")).count();
        assertEquals(1, pausedLines);
    }

    @Test
    @DisplayName("bad input is refused before any lookup and doesn't count as a try")
    void invalidInput() {
        assertEquals(Outcome.INVALID, service.reset(" ", PAT_BIRTHDAY, NEW_PASSWORD, IP).outcome());
        assertEquals(Outcome.INVALID, service.reset("pat", null, NEW_PASSWORD, IP).outcome());
        assertEquals(Outcome.INVALID, service.reset("pat", LocalDate.now().plusDays(1), NEW_PASSWORD, IP).outcome());
        var shortPw = service.reset("pat", PAT_BIRTHDAY, "abc", IP);
        assertEquals(Outcome.INVALID, shortPw.outcome());
        assertEquals("Password must be at least 6 characters.", shortPw.error());
        assertEquals(Outcome.INVALID, service.reset("pat", PAT_BIRTHDAY, "x".repeat(73), IP).outcome());
        verify(users, never()).findByUsernameIgnoreCase(any());
        assertTrue(redis.values.isEmpty());
    }

    @Test
    @DisplayName("the birthday and the password never reach the log, whatever happens")
    void nothingSecretLogged() {
        attempt("pat", PAT_BIRTHDAY.plusDays(3));
        attempt("nobody", PAT_BIRTHDAY);
        attempt("pat", PAT_BIRTHDAY);
        service.setBirthday(6L, LocalDate.of(1999, 12, 31), "sam");
        for (String m : logged()) {
            for (String secret : new String[]{"1987", "06-15", "6/15", "June", "1999", "12-31", NEW_PASSWORD}) {
                assertFalse(m.contains(secret), () -> "'" + secret + "' in: " + m);
            }
        }
    }

    @Test
    @DisplayName("every no-match takes at least the minimum time, so timing can't tell the kinds apart")
    void minimumTime() {
        service = new PasswordResetService(users, userService, redis.limiter(), events, notifications, 120);
        for (String u : new String[]{"nobody", "sam", "nobday", "pat"}) {
            long t0 = System.nanoTime();
            assertEquals(Outcome.NO_MATCH, attempt(u, PAT_BIRTHDAY.plusDays(1)));
            long ms = (System.nanoTime() - t0) / 1_000_000;
            assertTrue(ms >= 120, u + " took " + ms + " ms");
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
