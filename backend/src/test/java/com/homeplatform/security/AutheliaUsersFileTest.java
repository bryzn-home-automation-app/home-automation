package com.homeplatform.security;

import com.homeplatform.security.AutheliaUsersFile.Refused;
import com.homeplatform.security.AutheliaUsersFile.UsersFileException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Changing one password in Authelia's users file without disturbing anything else. The samples are
 * shaped like the real file (and like one Authelia saved itself), with made-up people and hashes.
 */
class AutheliaUsersFileTest {

    /** As the import script wrote it on the NUC: quoted values, flow-style groups, plus comments. */
    static final String SAMPLE = """
            # Home sign-in accounts (made-up people for tests).
            users:
              boss:
                displayname: "Boss"
                email: "boss@example.test"
                password: "$2a$10$fakeBOSSfakeBOSSfakeBOuL0ngFakeHashForTheBossAccount.xyz"
                groups: [admin, family]
              pat:
                displayname: "Pat"
                email: "pat@example.test"
                password: "$2a$10$fakePATfakePATfakePATfuL0ngFakeHashForThePatAccount.xyzz"
                groups: [family]
              robin:
                displayname: "Robin"   # the other member
                email: "Robin@Example.test"
                password: "$2a$10$fakeROBINfakeROBINfakeRL0ngFakeHashForTheRobinAccount.xy"
                groups: [family]
              helper:
                displayname: "Helper"
                email: "helper@example.test"
                password: "$2a$10$fakeHELPERfakeHELPERfakL0ngFakeHashForTheHelperAccount.x"
                groups: [view-only]
            """;

    /** As Authelia itself saves the file after a password change: 4-space indent, plain values, block lists. */
    static final String AUTHELIA_SAVED = """
            users:
                boss:
                    password: $argon2id$v=19$m=65536,t=3,p=4$ZmFrZXNhbHRmYWtlc2FsdA$ZmFrZWhhc2hmYWtlaGFzaGZha2VoYXNoZmFrZWhhcw
                    displayname: Boss
                    email: boss@example.test
                    groups:
                        - admin
                        - family
                    disabled: false
                pat:
                    password: $argon2id$v=19$m=65536,t=3,p=4$cGF0c2FsdHBhdHNhbHRwYQ$cGF0aGFzaHBhdGhhc2hwYXRoYXNocGF0aGFzaHBhdGg
                    displayname: Pat
                    email: pat@example.test
                    groups:
                        - family
                    disabled: false
            """;

    private static final String NEW_PASSWORD = "correct horse battery";

    @TempDir Path dir;
    private Path file;
    /** Argon2id at a test cost (1 MiB, 1 pass): same format, fast. Authelia's own cost has its own test. */
    private final Argon2PasswordEncoder argon2 = new Argon2PasswordEncoder(16, 32, 1, 1024, 1);
    private AutheliaUsersFile users;

    @BeforeEach
    void setUp() throws Exception {
        file = dir.resolve("users_database.yml");
        write(SAMPLE);
        users = new AutheliaUsersFile(file.toString(), "admin", argon2);
    }

    private void write(String text) throws Exception {
        Files.writeString(file, text, StandardCharsets.UTF_8);
    }

    private String text() throws Exception {
        return Files.readString(file, StandardCharsets.UTF_8);
    }

    /** {@code username}'s password value as it stands in the file (quotes stripped). */
    private String hashOf(String username) throws Exception {
        Matcher m = Pattern.compile("(?m)^\\s+" + username + ":\\R(?:\\s{3,}.*\\R)*?\\s+password: [\"']?([^\"'\\s]+)").matcher(text());
        assertTrue(m.find(), "no password for " + username);
        return m.group(1);
    }

    private List<Path> backups() throws Exception {
        Path backupDir = dir.resolve(AutheliaUsersFile.BACKUP_DIR);
        if (!Files.isDirectory(backupDir)) return List.of();
        try (Stream<Path> s = Files.list(backupDir)) {
            return s.filter(p -> p.getFileName().toString().startsWith("users_database.yml.")).sorted().toList();
        }
    }

    @Test
    @DisplayName("only the member's password value changes; comments, order, quoting and everyone else stay byte for byte")
    void onlyThePasswordValueChanges() throws Exception {
        var changed = users.setPassword("pat@example.test", NEW_PASSWORD);
        assertEquals("pat", changed.homeUsername());

        String after = text();
        String newHash = hashOf("pat");
        assertTrue(newHash.startsWith("$argon2id$v=19$"), newHash);
        assertTrue(argon2.matches(NEW_PASSWORD, newHash), "the hash is of the new password");
        String oldValue = "\"$2a$10$fakePATfakePATfakePATfuL0ngFakeHashForThePatAccount.xyzz\"";
        assertEquals(SAMPLE.replace(oldValue, "\"" + newHash + "\""), after, "nothing else changed");

        // The previous file is kept, exactly.
        assertEquals(1, backups().size());
        assertEquals(changed.backup(), backups().get(0).getFileName().toString());
        assertEquals(SAMPLE, Files.readString(backups().get(0)));
        // No temporary file is left beside it.
        try (Stream<Path> s = Files.list(dir)) {
            assertEquals(List.of("password-reset-backups", "users_database.yml"),
                    s.map(p -> p.getFileName().toString()).sorted().toList());
        }
    }

    @Test
    @DisplayName("the hash is argon2id at Authelia's own default cost, in the encoding Authelia reads")
    void autheliaCost() {
        Argon2PasswordEncoder authelia = AutheliaUsersFile.autheliaArgon2();
        String hash = authelia.encode(NEW_PASSWORD);
        assertTrue(hash.matches("\\$argon2id\\$v=19\\$m=65536,t=3,p=4\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}"), hash);
        assertTrue(authelia.matches(NEW_PASSWORD, hash));
        assertFalse(authelia.matches(NEW_PASSWORD + "!", hash));
    }

    @Test
    @DisplayName("a file Authelia saved itself (plain values, block lists) is edited the same way")
    void fileAutheliaSaved() throws Exception {
        write(AUTHELIA_SAVED);
        users.setPassword("PAT@example.test", NEW_PASSWORD);
        String newHash = hashOf("pat");
        String oldValue = "$argon2id$v=19$m=65536,t=3,p=4$cGF0c2FsdHBhdHNhbHRwYQ$cGF0aGFzaHBhdGhhc2hwYXRoYXNocGF0aGFzaHBhdGg";
        assertEquals(AUTHELIA_SAVED.replace(oldValue, "\"" + newHash + "\""), text());
        assertTrue(argon2.matches(NEW_PASSWORD, newHash));
    }

    @Test
    @DisplayName("a single-quoted value stays single-quoted")
    void singleQuoted() throws Exception {
        write(SAMPLE.replace("\"$2a$10$fakePATfakePATfakePATfuL0ngFakeHashForThePatAccount.xyzz\"",
                "'$2a$10$fakePATfakePATfakePATfuL0ngFakeHashForThePatAccount.xyzz'"));
        users.setPassword("pat@example.test", NEW_PASSWORD);
        assertTrue(text().contains("    password: '" + hashOf("pat") + "'\n"), text());
    }

    @Test
    @DisplayName("an account in an admin group is refused, and the file isn't touched")
    void adminRefused() throws Exception {
        Refused e = assertThrows(Refused.class, () -> users.setPassword("boss@example.test", NEW_PASSWORD));
        assertEquals("their Home account 'boss' is in the 'admin' group", e.getMessage());
        assertEquals(SAMPLE, text());
        assertTrue(backups().isEmpty());

        // Admin groups are matched without case, and there can be several.
        users = new AutheliaUsersFile(file.toString(), " Admin , owners ", argon2);
        write(SAMPLE.replace("groups: [view-only]", "groups: [Owners]"));
        assertThrows(Refused.class, () -> users.setPassword("helper@example.test", NEW_PASSWORD));
        assertThrows(Refused.class, () -> users.setPassword("boss@example.test", NEW_PASSWORD));
    }

    @Test
    @DisplayName("no Home account with the member's email: refused, file untouched")
    void missingRefused() throws Exception {
        Refused e = assertThrows(Refused.class, () -> users.setPassword("nobody@example.test", NEW_PASSWORD));
        assertEquals("no Home account uses their email", e.getMessage());
        assertThrows(Refused.class, () -> users.setPassword(null, NEW_PASSWORD));
        assertThrows(Refused.class, () -> users.setPassword(" ", NEW_PASSWORD));
        assertEquals(SAMPLE, text());
        assertTrue(backups().isEmpty());
    }

    @Test
    @DisplayName("a disabled Home account, or an email two accounts share, is refused")
    void disabledOrAmbiguousRefused() throws Exception {
        write(SAMPLE.replace("    groups: [family]\n  robin:", "    groups: [family]\n    disabled: true\n  robin:"));
        assertEquals("their Home account 'pat' is disabled",
                assertThrows(Refused.class, () -> users.setPassword("pat@example.test", NEW_PASSWORD)).getMessage());

        write(SAMPLE.replace("helper@example.test", "pat@example.test"));
        assertEquals("more than one Home account uses their email",
                assertThrows(Refused.class, () -> users.setPassword("pat@example.test", NEW_PASSWORD)).getMessage());
        assertTrue(backups().isEmpty());
    }

    @Test
    @DisplayName("the email is matched without regard to case, as Authelia signs people in")
    void emailIgnoresCase() throws Exception {
        assertEquals("robin", users.setPassword("robin@example.TEST", NEW_PASSWORD).homeUsername());
        assertTrue(users.read().forEmail("ROBIN@example.test").isPresent());
    }

    @Test
    @DisplayName("if the file doesn't read back as written, the previous one is put back")
    void damagedResultPutBack() throws Exception {
        users.afterReplace = () -> {
            try {
                write("users:\n  boss: [half a file");
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
        UsersFileException e = assertThrows(UsersFileException.class, () -> users.setPassword("pat@example.test", NEW_PASSWORD));
        assertTrue(e.getMessage().startsWith("didn't read back as written, so the previous file was put back from users_database.yml."), e.getMessage());
        assertFalse(e.signInAtRisk());
        assertEquals(SAMPLE, text(), "back to exactly what it was");
    }

    @Test
    @DisplayName("a whole users file someone else saved at that very moment is left alone, and the reset reports it")
    void savedByAnotherAtTheSameMoment() throws Exception {
        String theirs = SAMPLE.replace("displayname: \"Helper\"", "displayname: \"Helper Two\"");
        users.afterReplace = () -> {
            try {
                write(theirs);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
        UsersFileException e = assertThrows(UsersFileException.class, () -> users.setPassword("pat@example.test", NEW_PASSWORD));
        assertTrue(e.getMessage().contains("changed by something else"), e.getMessage());
        assertEquals(theirs, text());
    }

    @Test
    @DisplayName("a change saved between reading and replacing (Authelia's own) isn't lost: it starts over")
    void changedMidEdit() throws Exception {
        AtomicBoolean once = new AtomicBoolean();
        users.afterRead = () -> {
            if (once.compareAndSet(false, true)) {
                try {
                    Files.writeString(file, text().replace("displayname: \"Helper\"", "displayname: \"Helper (renamed)\""));
                } catch (Exception e) {
                    throw new RuntimeException(e);
                }
            }
        };
        users.setPassword("pat@example.test", NEW_PASSWORD);
        assertTrue(text().contains("displayname: \"Helper (renamed)\""), "the other change survives");
        assertTrue(argon2.matches(NEW_PASSWORD, hashOf("pat")));
    }

    @Test
    @DisplayName("resets at the same moment don't interleave: every one of them lands, none overwrites another")
    void concurrentResets() throws Exception {
        write(SAMPLE + """
                  casey:
                    displayname: "Casey"
                    email: "casey@example.test"
                    password: "$2a$10$fakeCASEYfakeCASEYfakeCL0ngFakeHashForTheCaseyAccount.xy"
                    groups: [family]
                """);
        // Widen the gap between reading and replacing, so an unserialised write would lose updates.
        users.afterRead = () -> {
            try {
                Thread.sleep(30);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        };
        List<String> people = List.of("pat", "robin", "helper", "casey");
        Map<String, String> passwords = new ConcurrentHashMap<>();
        CountDownLatch go = new CountDownLatch(1);
        List<Throwable> errors = new ArrayList<>();
        List<Thread> threads = new ArrayList<>();
        for (int round = 0; round < 3; round++) {
            for (String person : people) {
                String password = person + "-password-" + round;
                threads.add(new Thread(() -> {
                    try {
                        go.await();
                        users.setPassword(person + "@example.test", password);
                        passwords.merge(person, password, (a, b) -> a + "|" + b);
                    } catch (Throwable t) {
                        synchronized (errors) {
                            errors.add(t);
                        }
                    }
                }));
            }
        }
        threads.forEach(Thread::start);
        go.countDown();
        for (Thread t : threads) t.join(30_000);
        assertEquals(List.of(), errors);

        // Every account ends with a hash of one of the passwords it was given, none with the old one.
        var accounts = AutheliaUsers.parse(text());
        assertEquals(List.of("boss", "pat", "robin", "helper", "casey"), accounts.usernames());
        for (String person : people) {
            String hash = hashOf(person);
            boolean any = Stream.of(passwords.get(person).split("\\|")).anyMatch(p -> argon2.matches(p, hash));
            assertTrue(any, person + " lost its update");
        }
        assertTrue(hashOf("boss").startsWith("$2a$10$fakeBOSS"), "the admin's untouched");
        assertEquals(10, backups().size(), "12 changes, 12 backups taken, the newest 10 kept");
    }

    @Test
    @DisplayName("backups are kept to the newest ten, readable by their owner only")
    void backupsPruned() throws Exception {
        for (int i = 0; i < 12; i++) users.setPassword("pat@example.test", NEW_PASSWORD + i);
        List<Path> kept = backups();
        assertEquals(AutheliaUsersFile.KEEP_BACKUPS, kept.size());
        assertTrue(argon2.matches(NEW_PASSWORD + "11", hashOf("pat")), "the last one wins");
        // The newest backup is the file just before the last change.
        String newest = Files.readString(kept.get(kept.size() - 1));
        assertFalse(newest.contains(hashOf("pat")));
        assertTrue(newest.contains("$2a$10$fakeBOSS"));
        if (Files.getFileStore(dir).supportsFileAttributeView(PosixFileAttributeView.class)) {
            assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(kept.get(0))));
        }
    }

    @Test
    @DisplayName("the new file keeps the old one's mode")
    void keepsMode() throws Exception {
        if (!Files.getFileStore(dir).supportsFileAttributeView(PosixFileAttributeView.class)) return; // Windows
        Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-r-----"));
        users.setPassword("pat@example.test", NEW_PASSWORD);
        assertEquals("rw-r-----", PosixFilePermissions.toString(Files.getPosixFilePermissions(file)));
    }

    @Test
    @DisplayName("missing, unconfigured, not YAML, or no users: refused without quoting the file")
    void unusableFiles() throws Exception {
        assertFalse(new AutheliaUsersFile("", "admin", argon2).isConfigured());
        assertThrows(UsersFileException.class, () -> new AutheliaUsersFile(" ", "admin", argon2).read());
        assertThrows(UsersFileException.class, () -> new AutheliaUsersFile(dir.resolve("nope.yml").toString(), "admin", argon2).read());

        write("users:\n  pat:\n    password: \"$2a$10$SECRETSECRETSECRET\n    groups: [family\n");
        UsersFileException e = assertThrows(UsersFileException.class, () -> users.read());
        assertTrue(e.getMessage().startsWith("isn't valid YAML"), e.getMessage());
        assertFalse(e.getMessage().contains("SECRET"), e.getMessage());
        assertThrows(UsersFileException.class, () -> users.setPassword("pat@example.test", NEW_PASSWORD));

        write("users: {}\n");
        assertEquals("has no users", assertThrows(UsersFileException.class, () -> users.read()).getMessage());
        write("users:\n  pat:\n    email: pat@example.test\n");
        assertEquals("has no password for 'pat'", assertThrows(UsersFileException.class, () -> users.read()).getMessage());
        write(SAMPLE + "  pat:\n    password: \"x\"\n");
        assertTrue(assertThrows(UsersFileException.class, () -> users.read()).getMessage().startsWith("isn't valid YAML"),
                "a username listed twice");
        Files.write(file, new byte[]{'u', 's', 'e', 'r', 's', ':', ' ', (byte) 0xC3, (byte) 0x28});
        assertEquals("isn't UTF-8 text", assertThrows(UsersFileException.class, () -> users.read()).getMessage());
    }

    @Test
    @DisplayName("the splice refuses a password written as a block, and anything that isn't a hash")
    void spliceGuards() throws Exception {
        String block = SAMPLE.replace("password: \"$2a$10$fakePATfakePATfakePATfuL0ngFakeHashForThePatAccount.xyzz\"",
                "password: |\n      $2a$10$fakePATfakePATfakePATfuL0ngFakeHashForThePatAccount.xyzz");
        var parsed = AutheliaUsers.parse(block);
        assertThrows(UsersFileException.class, () -> AutheliaUsers.withPassword(parsed, "pat", "$argon2id$v=19$m=1,t=1,p=1$abc$def"));
        var sample = AutheliaUsers.parse(SAMPLE);
        assertThrows(IllegalArgumentException.class, () -> AutheliaUsers.withPassword(sample, "pat", "\"\nadmin: true"));
        assertThrows(UsersFileException.class, () -> AutheliaUsers.withPassword(sample, "nobody", "$argon2id$v=19$m=1,t=1,p=1$abc$def"));
    }

    @Test
    @DisplayName("reading lists everyone with their emails, groups and whether they're disabled")
    void readsAccounts() throws Exception {
        var accounts = users.read();
        assertEquals(List.of("boss", "pat", "robin", "helper"), accounts.all().stream().map(AutheliaUsersFile.Account::username).toList());
        assertEquals(List.of("admin", "family"), accounts.all().get(0).groups());
        assertNull(accounts.refusal("pat@example.test"));
        assertNull(accounts.refusal("helper@example.test"), "view-only isn't an admin group");
        assertNotNull(accounts.refusal("boss@example.test"));
    }
}
