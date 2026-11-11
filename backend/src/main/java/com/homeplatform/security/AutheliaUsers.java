package com.homeplatform.security;

import com.homeplatform.security.AutheliaUsersFile.Account;
import com.homeplatform.security.AutheliaUsersFile.UsersFileException;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import org.yaml.snakeyaml.constructor.SafeConstructor;
import org.yaml.snakeyaml.error.Mark;
import org.yaml.snakeyaml.error.MarkedYAMLException;
import org.yaml.snakeyaml.nodes.MappingNode;
import org.yaml.snakeyaml.nodes.Node;
import org.yaml.snakeyaml.nodes.NodeTuple;
import org.yaml.snakeyaml.nodes.ScalarNode;

import java.io.StringReader;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Authelia's file user database (users_database.yml in ../home-sso) as text: who is in it, and the
 * same text with one person's password changed and every other byte left as it was.
 *
 * <p>The change is a splice, not a rewrite: the YAML parser says where that person's password value
 * starts and ends, and only those characters are replaced. Comments, order, quoting and everyone
 * else's entries stay as Authelia (or a person) wrote them. The result is parsed again and must
 * equal the original with that one value changed, or nothing is returned.
 *
 * <p>Error messages here may reach the admin's log and notices, so they never quote the file: a
 * parser message would show the offending line, which can be someone's password hash.
 */
final class AutheliaUsers {

    /** The characters of a crypt-style hash ({@code $argon2id$v=19$m=…$salt$hash}): safe inside quotes. */
    private static final Pattern HASH = Pattern.compile("\\$[a-z0-9]+\\$[A-Za-z0-9$=,.+/-]+");

    private AutheliaUsers() {}

    /** Where one password value sits in the text: [start, end) in chars, and how it's quoted. */
    record Span(int start, int end, org.yaml.snakeyaml.DumperOptions.ScalarStyle style) {}

    /**
     * A parsed users file.
     *
     * @param tree     the whole file as plain Java values, for comparing before and after
     * @param accounts every person, in file order
     * @param spans    username → where their password value is
     */
    record Parsed(String text, Map<String, Object> tree, List<Account> accounts, Map<String, Span> spans) {
        List<String> usernames() {
            return accounts.stream().map(Account::username).toList();
        }
    }

    static Parsed parse(String text) throws UsersFileException {
        Object loaded;
        Node root;
        try {
            Yaml yaml = new Yaml(new SafeConstructor(loaderOptions()));
            loaded = yaml.load(text);
            root = new Yaml(new SafeConstructor(loaderOptions())).compose(new StringReader(text));
        } catch (MarkedYAMLException e) {
            Mark at = e.getProblemMark() != null ? e.getProblemMark() : e.getContextMark();
            throw new UsersFileException("isn't valid YAML" + (at != null ? " (near line " + (at.getLine() + 1) + ")" : ""));
        } catch (RuntimeException e) {
            throw new UsersFileException("isn't valid YAML (" + e.getClass().getSimpleName() + ")");
        }
        if (!(loaded instanceof Map<?, ?> top) || !(root instanceof MappingNode rootNode)) {
            throw new UsersFileException("isn't a users file (no top-level mapping)");
        }
        MappingNode usersNode = null;
        for (NodeTuple t : rootNode.getValue()) {
            if (t.getKeyNode() instanceof ScalarNode k && "users".equals(k.getValue()) && t.getValueNode() instanceof MappingNode m) {
                usersNode = m;
            }
        }
        if (usersNode == null || !(top.get("users") instanceof Map<?, ?> usersMap) || usersMap.isEmpty()
                || usersMap.size() != usersNode.getValue().size()) {
            throw new UsersFileException("has no users");
        }

        List<Account> accounts = new ArrayList<>();
        Map<String, Span> spans = new LinkedHashMap<>();
        List<? extends Map.Entry<?, ?>> entries = new ArrayList<>(usersMap.entrySet());
        for (int i = 0; i < entries.size(); i++) {
            NodeTuple tuple = usersNode.getValue().get(i);
            String username = String.valueOf(entries.get(i).getKey());
            if (!(tuple.getKeyNode() instanceof ScalarNode key) || !key.getValue().equals(username)) {
                throw new UsersFileException("has a user entry this can't read (entry " + (i + 1) + ")");
            }
            if (spans.containsKey(username)) throw new UsersFileException("lists '" + username + "' twice");
            if (!(entries.get(i).getValue() instanceof Map<?, ?> fields) || !(tuple.getValueNode() instanceof MappingNode fieldsNode)) {
                throw new UsersFileException("has an entry for '" + username + "' that isn't a mapping");
            }
            ScalarNode password = null;
            for (NodeTuple f : fieldsNode.getValue()) {
                if (f.getKeyNode() instanceof ScalarNode fk && "password".equals(fk.getValue())) {
                    if (!(f.getValueNode() instanceof ScalarNode s)) {
                        throw new UsersFileException("has a password for '" + username + "' that isn't a single value");
                    }
                    password = s;
                }
            }
            if (password == null || !(fields.get("password") instanceof String)) {
                throw new UsersFileException("has no password for '" + username + "'");
            }
            spans.put(username, new Span(offset(text, password.getStartMark()), offset(text, password.getEndMark()),
                    password.getScalarStyle()));
            Object disabled = fields.get("disabled");
            accounts.add(new Account(username, strings(fields.get("email")), strings(fields.get("groups")),
                    disabled != null && !Boolean.FALSE.equals(disabled)));
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> tree = (Map<String, Object>) loaded;
        return new Parsed(text, tree, List.copyOf(accounts), spans);
    }

    /**
     * {@code doc}'s text with {@code username}'s password value replaced by {@code hash}, quoted as
     * before (a plain value becomes double-quoted, which every YAML reader takes the same way).
     * Throws unless the result parses to exactly the original with that one value changed.
     */
    static String withPassword(Parsed doc, String username, String hash) throws UsersFileException {
        if (hash == null || !HASH.matcher(hash).matches()) throw new IllegalArgumentException("not a password hash");
        Span span = doc.spans().get(username);
        if (span == null) throw new UsersFileException("has no user '" + username + "'");
        String quote = switch (span.style()) {
            case DOUBLE_QUOTED, PLAIN -> "\"";
            case SINGLE_QUOTED -> "'";
            default -> throw new UsersFileException("has the password for '" + username + "' written as a block, which this doesn't edit");
        };
        String text = doc.text().substring(0, span.start()) + quote + hash + quote + doc.text().substring(span.end());

        Parsed after = parse(text);
        Map<String, Object> expected = deepCopy(doc.tree());
        Map<?, ?> users = (Map<?, ?>) expected.get("users");
        for (Map.Entry<?, ?> e : users.entrySet()) {
            if (String.valueOf(e.getKey()).equals(username)) {
                @SuppressWarnings("unchecked")
                Map<Object, Object> fields = (Map<Object, Object>) e.getValue();
                fields.put("password", hash);
            }
        }
        if (!expected.equals(after.tree()) || !doc.usernames().equals(after.usernames())) {
            throw new UsersFileException("would have changed more than one password, so it was left as it was");
        }
        return text;
    }

    private static LoaderOptions loaderOptions() {
        LoaderOptions options = new LoaderOptions();
        options.setAllowDuplicateKeys(false);
        options.setAllowRecursiveKeys(false);
        options.setMaxAliasesForCollections(10);
        options.setCodePointLimit(1024 * 1024);
        return options;
    }

    /** A parser mark (counted in code points) as a char offset into {@code text}. */
    private static int offset(String text, Mark mark) {
        return text.offsetByCodePoints(0, mark.getIndex());
    }

    /** A YAML value that may be one string or a list of them (Authelia's email, groups). */
    private static List<String> strings(Object value) {
        if (value == null) return List.of();
        if (value instanceof List<?> list) return list.stream().filter(v -> v != null).map(String::valueOf).toList();
        return List.of(String.valueOf(value));
    }

    @SuppressWarnings("unchecked")
    private static <T> T deepCopy(T value) {
        if (value instanceof Map<?, ?> m) {
            Map<Object, Object> copy = new LinkedHashMap<>();
            m.forEach((k, v) -> copy.put(k, deepCopy(v)));
            return (T) copy;
        }
        if (value instanceof List<?> l) {
            List<Object> copy = new ArrayList<>();
            l.forEach(v -> copy.add(deepCopy(v)));
            return (T) copy;
        }
        return value;
    }
}
