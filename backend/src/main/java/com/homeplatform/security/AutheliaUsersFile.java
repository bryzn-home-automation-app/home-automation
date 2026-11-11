package com.homeplatform.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * The household's Home sign-in passwords: Authelia's file user database (../home-sso,
 * {@code /data/users_database.yml} in its container). docker-compose mounts Authelia's data volume
 * here at {@code /authelia}, and {@code AUTHELIA_USERS_FILE} names the file; unset, this is off.
 *
 * <p>That file is the only user database for every app behind "Sign in with Home", the admin's
 * account included, so a bad write would lock the whole house out. A change therefore:
 * <ol>
 *   <li>hashes the new password with argon2id at Authelia's default cost (what Authelia itself
 *       writes for a changed password), and checks the hash against the password;</li>
 *   <li>under one lock (in this process, and a file lock beside the file), reads the file and checks
 *       again that the person may be changed this way: exactly one account uses their email, it's
 *       not disabled and not in an admin group;</li>
 *   <li>replaces only that person's password value ({@link AutheliaUsers#withPassword}), and the
 *       result must parse to the original with that one value changed;</li>
 *   <li>saves the previous file in {@code password-reset-backups/} next to it (newest
 *       {@value #KEEP_BACKUPS} kept);</li>
 *   <li>writes the new text to a temporary file in the same folder, syncs it and reads it back, and
 *       only then renames it over the old one, so Authelia (which watches the folder and reloads on
 *       the rename) never sees a half-written file. If the file changed meanwhile, it starts over;</li>
 *   <li>reads the file back: if it isn't what was written and isn't a whole users file any more,
 *       the backup is put back.</li>
 * </ol>
 * Nothing here logs a password, a hash or the file's contents.
 */
@Component
public class AutheliaUsersFile {

    private static final Logger log = LoggerFactory.getLogger(AutheliaUsersFile.class);

    static final String BACKUP_DIR = "password-reset-backups";
    static final int KEEP_BACKUPS = 10;
    private static final int TRIES = 3;
    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").withZone(ZoneOffset.UTC);

    /**
     * Authelia 4.39's own argon2 settings (its defaults, which home-sso's configuration keeps):
     * argon2id, 3 iterations, 64 MiB, parallelism 4, 32-byte key, 16-byte salt. Written as
     * {@code $argon2id$v=19$m=65536,t=3,p=4$<salt>$<key>}, unpadded base64, which Authelia reads.
     */
    static Argon2PasswordEncoder autheliaArgon2() {
        return new Argon2PasswordEncoder(16, 32, 4, 65536, 3);
    }

    /** One person in the users file. */
    public record Account(String username, List<String> emails, List<String> groups, boolean disabled) {}

    /** Everyone in the users file, and which groups make an account an admin's. */
    public record Accounts(List<Account> all, Set<String> adminGroups) {

        /** The one account whose email is {@code email}, if exactly one is. */
        public Optional<Account> forEmail(String email) {
            List<Account> matches = matching(email);
            return matches.size() == 1 ? Optional.of(matches.get(0)) : Optional.empty();
        }

        /**
         * Why the Home account for the member with {@code email} can't have its password reset by
         * birthday, or null when it can. For the log and the admin only.
         */
        public String refusal(String email) {
            if (email == null || email.isBlank()) return "the member has no email to find their Home account by";
            List<Account> matches = matching(email);
            if (matches.isEmpty()) return "no Home account uses their email";
            if (matches.size() > 1) return "more than one Home account uses their email";
            Account a = matches.get(0);
            if (a.disabled()) return "their Home account '" + a.username() + "' is disabled";
            for (String g : a.groups()) {
                if (adminGroups.contains(g.toLowerCase(Locale.ROOT))) {
                    return "their Home account '" + a.username() + "' is in the '" + g + "' group";
                }
            }
            return null;
        }

        private List<Account> matching(String email) {
            if (email == null) return List.of();
            String wanted = email.trim();
            return all.stream().filter(a -> a.emails().stream().anyMatch(e -> e.trim().equalsIgnoreCase(wanted))).toList();
        }
    }

    /** A change that went through: whose Home account, and the backup of the file before it. */
    public record Changed(String homeUsername, String backup) {}

    /** The account may not be changed this way (the reason is for the log and the admin). */
    public static class Refused extends Exception {
        public Refused(String reason) {
            super(reason);
        }
    }

    /**
     * The file couldn't be read, isn't a users file, or couldn't be changed safely. The message
     * completes "The Home users file …" and never quotes the file.
     */
    public static class UsersFileException extends Exception {
        private final boolean signInAtRisk;

        public UsersFileException(String reason) {
            this(reason, false, null);
        }

        public UsersFileException(String reason, Throwable cause) {
            this(reason, false, cause);
        }

        public UsersFileException(String reason, boolean signInAtRisk, Throwable cause) {
            super(reason, cause);
            this.signInAtRisk = signInAtRisk;
        }

        /** True when the file may be left broken (putting the backup back failed too). */
        public boolean signInAtRisk() {
            return signInAtRisk;
        }
    }

    private final Path file;
    private final Set<String> adminGroups;
    private final Argon2PasswordEncoder argon2;
    private final ReentrantLock lock = new ReentrantLock();

    /** Tests: runs after the file is read and before it's replaced (to widen a race). */
    Runnable afterRead = () -> {};
    /** Tests: runs right after the rename (to damage the result). */
    Runnable afterReplace = () -> {};

    @Autowired
    public AutheliaUsersFile(@Value("${app.password-reset.authelia-users-file:}") String location,
                             @Value("${app.password-reset.authelia-admin-groups:admin}") String adminGroups) {
        this(location, adminGroups, autheliaArgon2());
    }

    AutheliaUsersFile(String location, String adminGroups, Argon2PasswordEncoder argon2) {
        this.file = location == null || location.isBlank() ? null : Path.of(location.trim()).toAbsolutePath();
        this.adminGroups = Stream.of((adminGroups == null ? "" : adminGroups).split(","))
                .map(g -> g.trim().toLowerCase(Locale.ROOT)).filter(g -> !g.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
        this.argon2 = argon2;
        if (file == null) {
            log.info("Forgot password is off: AUTHELIA_USERS_FILE isn't set");
        } else {
            log.info("Forgot password sets Home passwords in {} ({}); admin groups {}", file,
                    Files.isRegularFile(file) ? "found" : "NOT FOUND, resets will be unavailable", this.adminGroups);
        }
    }

    public boolean isConfigured() {
        return file != null;
    }

    /** Everyone in the file, read and checked now. */
    public Accounts read() throws UsersFileException {
        requireConfigured();
        try {
            return accounts(AutheliaUsers.parse(decode(Files.readAllBytes(file))));
        } catch (IOException e) {
            throw new UsersFileException("couldn't be read (" + e.getClass().getSimpleName() + ")", e);
        }
    }

    /**
     * Gives the Home account that uses {@code email} the password {@code newPassword}, as described
     * on this class.
     *
     * @throws Refused           that account may not be changed this way; the file is untouched
     * @throws UsersFileException the file couldn't be read or changed safely; it's either untouched
     *                           or put back from the backup, unless {@link UsersFileException#signInAtRisk()}
     */
    public Changed setPassword(String email, String newPassword) throws Refused, UsersFileException {
        requireConfigured();
        // Before the lock: it's the slow part and needs nothing from the file.
        String hash = argon2.encode(newPassword);
        if (!hash.startsWith("$argon2id$") || !argon2.matches(newPassword, hash)) {
            throw new UsersFileException("wasn't changed: the new password couldn't be hashed");
        }
        lock.lock();
        try (FileChannel lockChannel = FileChannel.open(lockFile(), StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             FileLock ignored = lockChannel.lock()) {
            for (int attempt = 1; ; attempt++) {
                byte[] before = Files.readAllBytes(file);
                AutheliaUsers.Parsed doc = AutheliaUsers.parse(decode(before));
                Accounts accounts = accounts(doc);
                String refusal = accounts.refusal(email);
                if (refusal != null) throw new Refused(refusal);
                String username = accounts.forEmail(email).orElseThrow().username();
                byte[] after = AutheliaUsers.withPassword(doc, username, hash).getBytes(StandardCharsets.UTF_8);
                afterRead.run();

                Path backup = backup(before);
                Path tmp = writeTemp(after);
                try {
                    if (!Arrays.equals(before, Files.readAllBytes(file))) {
                        // Saved by something else meanwhile (Authelia's own password change): start
                        // over from what's there now, so that change isn't lost.
                        if (attempt < TRIES) continue;
                        throw new UsersFileException("kept changing while being edited, so it was left as it was");
                    }
                    Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE);
                } finally {
                    Files.deleteIfExists(tmp);
                }
                syncFolder();
                afterReplace.run();
                checkReplaced(doc, before, after, backup);
                pruneBackups();
                log.info("Home password changed for '{}' in {}; previous file kept as {}", username, file, backup.getFileName());
                return new Changed(username, backup.getFileName().toString());
            }
        } catch (IOException e) {
            throw new UsersFileException("couldn't be read or written (" + e.getClass().getSimpleName() + "), so it was left as it was", e);
        } finally {
            lock.unlock();
        }
    }

    /** After the rename: the file must be what was written, or at least still a whole users file. */
    private void checkReplaced(AutheliaUsers.Parsed doc, byte[] before, byte[] written, Path backup)
            throws IOException, UsersFileException {
        byte[] now = Files.readAllBytes(file);
        if (Arrays.equals(now, written)) return;
        boolean whole;
        try {
            whole = AutheliaUsers.parse(decode(now)).usernames().containsAll(doc.usernames());
        } catch (UsersFileException e) {
            whole = false;
        }
        if (whole) {
            throw new UsersFileException("was changed by something else at the same moment, so this new password may not have been kept");
        }
        restore(backup, before);
        throw new UsersFileException("didn't read back as written, so the previous file was put back from "
                + backup.getFileName() + "; nothing changed");
    }

    private void restore(Path backup, byte[] before) throws UsersFileException {
        try {
            Path tmp = writeTemp(before);
            try {
                Files.move(tmp, file, StandardCopyOption.ATOMIC_MOVE);
            } finally {
                Files.deleteIfExists(tmp);
            }
            syncFolder();
            if (!Arrays.equals(before, Files.readAllBytes(file))) throw new IOException("read back differently");
            log.error("Home users file {} didn't read back as written after a password reset; put back {}", file, backup.getFileName());
        } catch (IOException | UsersFileException e) {
            log.error("Home users file {}: putting back {} FAILED ({}); Home sign-in may be broken until it's restored by hand",
                    file, backup, e.getClass().getSimpleName());
            throw new UsersFileException("didn't read back as written, and putting the previous file back failed too. "
                    + "Home sign-in may be broken: restore " + backup + " by hand", true, e);
        }
    }

    /** {@code bytes} in a new temporary file beside the users file: synced, read back, same owner and mode. */
    private Path writeTemp(byte[] bytes) throws IOException, UsersFileException {
        Path tmp = file.resolveSibling("." + file.getFileName() + ".reset-" + UUID.randomUUID() + ".tmp");
        writeSynced(tmp, bytes);
        copyOwnerAndMode(file, tmp);
        if (!Arrays.equals(bytes, Files.readAllBytes(tmp))) {
            Files.deleteIfExists(tmp);
            throw new UsersFileException("couldn't be written out in full (disk full?), so it was left as it was");
        }
        return tmp;
    }

    /** The file as it was, in password-reset-backups/ beside it, readable by its owner only. */
    private Path backup(byte[] before) throws IOException {
        Path dir = backupDir();
        Files.createDirectories(dir);
        Path target = dir.resolve(file.getFileName() + "." + STAMP.format(Instant.now()));
        for (int n = 1; Files.exists(target); n++) {
            target = dir.resolve(file.getFileName() + "." + STAMP.format(Instant.now()) + "-" + n);
        }
        Path tmp = dir.resolve("." + target.getFileName() + ".tmp");
        writeSynced(tmp, before);
        if (posix(tmp)) Files.setPosixFilePermissions(tmp, PosixFilePermissions.fromString("rw-------"));
        Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE);
        return target;
    }

    private void pruneBackups() {
        String prefix = file.getFileName() + ".";
        try (Stream<Path> files = Files.list(backupDir())) {
            List<Path> backups = files.filter(p -> p.getFileName().toString().startsWith(prefix)).sorted().toList();
            for (Path old : backups.subList(0, Math.max(0, backups.size() - KEEP_BACKUPS))) {
                Files.deleteIfExists(old);
            }
        } catch (IOException e) {
            log.warn("Couldn't prune old Home users file backups: {}", e.getClass().getSimpleName());
        }
    }

    private Accounts accounts(AutheliaUsers.Parsed doc) {
        return new Accounts(doc.accounts(), adminGroups);
    }

    Path backupDir() {
        return file.resolveSibling(BACKUP_DIR);
    }

    private Path lockFile() throws IOException {
        Files.createDirectories(backupDir());
        return backupDir().resolve(".lock");
    }

    private void requireConfigured() throws UsersFileException {
        if (file == null) throw new UsersFileException("isn't configured (AUTHELIA_USERS_FILE)");
        if (!Files.isRegularFile(file)) throw new UsersFileException("isn't there (" + file + ")");
    }

    /** Strict UTF-8, so text → bytes gives back exactly the bytes that were read. */
    private static String decode(byte[] bytes) throws UsersFileException {
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException e) {
            throw new UsersFileException("isn't UTF-8 text");
        }
    }

    private static void writeSynced(Path path, byte[] bytes) throws IOException {
        try (FileChannel ch = FileChannel.open(path, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            ByteBuffer buf = ByteBuffer.wrap(bytes);
            while (buf.hasRemaining()) ch.write(buf);
            ch.force(true);
        }
    }

    /** Makes the rename itself durable. Linux only; elsewhere (tests on Windows) a no-op. */
    private void syncFolder() {
        try (FileChannel dir = FileChannel.open(file.getParent(), StandardOpenOption.READ)) {
            dir.force(true);
        } catch (IOException | RuntimeException e) {
            // Not supported on this platform; the rename has still happened.
        }
    }

    private static void copyOwnerAndMode(Path from, Path to) {
        if (!posix(from)) return;
        try {
            PosixFileAttributes attrs = Files.readAttributes(from, PosixFileAttributes.class);
            Files.setPosixFilePermissions(to, attrs.permissions());
            PosixFileAttributeView view = Files.getFileAttributeView(to, PosixFileAttributeView.class);
            if (!attrs.owner().equals(Files.getOwner(to))) view.setOwner(attrs.owner());
            if (!attrs.group().equals(Files.readAttributes(to, PosixFileAttributes.class).group())) view.setGroup(attrs.group());
        } catch (IOException | UnsupportedOperationException | SecurityException e) {
            log.warn("Couldn't give the new Home users file the old one's owner and mode: {}", e.getClass().getSimpleName());
        }
    }

    private static boolean posix(Path path) {
        try {
            return Files.getFileStore(path).supportsFileAttributeView(PosixFileAttributeView.class);
        } catch (IOException e) {
            return false;
        }
    }
}
