package com.homeplatform.service;

import com.homeplatform.dto.DueReminderResponse;
import com.homeplatform.dto.HeadsUpOptionResponse;
import com.homeplatform.dto.ReminderRequest;
import com.homeplatform.dto.ReminderResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.Reminder;
import com.homeplatform.model.ReminderAlertSent;
import com.homeplatform.model.ReminderCompletion;
import com.homeplatform.model.User;
import com.homeplatform.repository.ReminderAlertSentRepository;
import com.homeplatform.repository.ReminderCompletionRepository;
import com.homeplatform.repository.ReminderRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.service.ReminderSchedule.HeadsUp;
import com.homeplatform.service.ReminderSchedule.HeadsUpKind;
import com.homeplatform.service.ReminderSchedule.Repeat;
import com.homeplatform.service.ReminderSchedule.Rule;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DayOfWeek;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static com.homeplatform.service.ReminderSchedule.HOME;
import static com.homeplatform.service.ReminderSchedule.instant;

/**
 * Household reminders (the Reminders page and Home's Reminders panel). Shared by every member:
 * anyone can add, change, delete and complete them; guests never reach this (the controller
 * refuses them). Completing marks one occurrence (due date) done for everyone. Heads-up alerts
 * are found by {@link #pendingAlerts} and sent once each by {@link #send}, which the
 * {@link ReminderScheduler} drives every minute.
 */
@Service
public class ReminderService {

    private static final Logger log = LoggerFactory.getLogger(ReminderService.class);

    static final int NAME_MAX = 60;
    static final int NOTE_MAX = 200;
    static final int MAX_HEADS_UPS = 8;
    static final int MAX_REMINDERS = 100;
    /** Done tapped just after the done-by time still counts (the request was on its way). */
    static final Duration COMPLETE_GRACE = Duration.ofHours(1);

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter MOMENT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm");

    /** The reminder doesn't exist (any more). */
    public static class NotFound extends RuntimeException {
        public NotFound() {
            super("That reminder doesn't exist any more");
        }
    }

    /** A request after validation. */
    record Spec(String name, String note, Rule rule, LocalTime dueBy, List<HeadsUp> headsUps, Boolean alerts) {}

    /** A heads-up (or several, after downtime) due for one occurrence: all are recorded, {@code sendKey} is sent. */
    public record PendingAlert(Long reminderId, LocalDate date, List<String> keys, String sendKey) {}

    private final ReminderRepository reminders;
    private final ReminderCompletionRepository completions;
    private final ReminderAlertSentRepository alerts;
    private final UserRepository users;
    private final NotificationService notifications;
    private final Clock clock;

    @Autowired
    public ReminderService(ReminderRepository reminders, ReminderCompletionRepository completions,
                           ReminderAlertSentRepository alerts, UserRepository users, NotificationService notifications) {
        this(reminders, completions, alerts, users, notifications, Clock.system(HOME));
    }

    ReminderService(ReminderRepository reminders, ReminderCompletionRepository completions,
                    ReminderAlertSentRepository alerts, UserRepository users, NotificationService notifications,
                    Clock clock) {
        this.reminders = reminders;
        this.completions = completions;
        this.alerts = alerts;
        this.users = users;
        this.notifications = notifications;
        this.clock = clock;
    }

    // ── Reading ──

    /** Every reminder, by name, with where it stands now. */
    public List<ReminderResponse> list() {
        Instant now = clock.instant();
        List<Reminder> all = reminders.findAllByOrderByNameAsc();
        Map<Long, Map<LocalDate, ReminderCompletion>> done = completionsAhead(now);
        Map<Long, String> names = names(all.stream().flatMap(r -> Stream.of(r.getCreatedBy())), done);
        return all.stream().map(r -> response(r, done.getOrDefault(r.getId(), Map.of()), names, now)).toList();
    }

    public ReminderResponse get(Long id) {
        Reminder r = reminders.findById(id).orElseThrow(NotFound::new);
        return responseFor(r);
    }

    /** What Home shows now: reminders inside their window and not done, soonest due first. */
    public List<DueReminderResponse> due() {
        Instant now = clock.instant();
        Map<Long, Map<LocalDate, ReminderCompletion>> done = completionsAhead(now);
        List<DueReminderResponse> out = new ArrayList<>();
        for (Reminder r : reminders.findAllByOrderByNameAsc()) {
            List<HeadsUp> headsUps = ReminderSchedule.split(r.getHeadsUps());
            Map<LocalDate, ReminderCompletion> mine = done.getOrDefault(r.getId(), Map.of());
            LocalDate open = ReminderSchedule.upcoming(rule(r), r.getDueBy(), now, ReminderSchedule.LOOKAHEAD).stream()
                    .filter(d -> !mine.containsKey(d)).findFirst().orElse(null);
            if (open == null || !ReminderSchedule.inWindow(open, r.getDueBy(), headsUps, now)) continue;
            out.add(new DueReminderResponse(r.getId(), r.getName(), r.getNote(), open.toString(), time(r.getDueBy()),
                    ReminderSchedule.showFrom(open, headsUps).format(MOMENT),
                    ReminderSchedule.dueAt(open, r.getDueBy()).format(MOMENT)));
        }
        out.sort((a, b) -> a.dueAt().compareTo(b.dueAt()));
        return out;
    }

    /** The heads-up choices for the form, presets with their times. */
    public static List<HeadsUpOptionResponse> options() {
        return Arrays.stream(HeadsUpKind.values()).map(k -> new HeadsUpOptionResponse(k.name(), k.label(),
                k.daysBefore(),
                k == HeadsUpKind.DAYS_BEFORE ? time(ReminderSchedule.DAYS_BEFORE_DEFAULT_TIME) : time(k.time()),
                !k.preset())).toList();
    }

    // ── Changing ──

    @Transactional
    public ReminderResponse create(ReminderRequest req, Long userId) {
        if (reminders.count() >= MAX_REMINDERS) {
            throw new IllegalArgumentException("There are already " + MAX_REMINDERS + " reminders. Delete one first");
        }
        LocalDateTime now = nowLocal();
        Spec s = validate(req, now.toLocalDate(), null);
        Reminder r = Reminder.builder().createdBy(userId).createdAt(now).build();
        apply(r, s, userId, now);
        r = reminders.save(r);
        log.info("Reminder added by user {}: {} (id={})", userId, r.getName(), r.getId());
        return responseFor(r);
    }

    @Transactional
    public ReminderResponse update(Long id, ReminderRequest req, Long userId) {
        Reminder r = reminders.findById(id).orElseThrow(NotFound::new);
        LocalDateTime now = nowLocal();
        Spec s = validate(req, now.toLocalDate(), r.getOnceDate());
        apply(r, s, userId, now);
        r = reminders.save(r);
        log.info("Reminder changed by user {}: {} (id={})", userId, r.getName(), id);
        return responseFor(r);
    }

    /** The per-reminder alerts switch. Turning it on doesn't send heads-ups that were due before. */
    @Transactional
    public ReminderResponse setAlerts(Long id, boolean on, Long userId) {
        Reminder r = reminders.findById(id).orElseThrow(NotFound::new);
        LocalDateTime now = nowLocal();
        if (on && !r.isAlertsEnabled()) r.setAlertsFrom(now);
        r.setAlertsEnabled(on);
        r.setUpdatedBy(userId);
        r.setUpdatedAt(now);
        return responseFor(reminders.save(r));
    }

    @Transactional
    public void delete(Long id, Long userId) {
        Reminder r = reminders.findById(id).orElseThrow(NotFound::new);
        completions.deleteByReminderId(id);
        alerts.deleteByReminderId(id);
        reminders.delete(r);
        log.info("Reminder deleted by user {}: {} (id={})", userId, r.getName(), id);
    }

    /** Marks the occurrence due on {@code date} done for the household. Doing it twice is harmless. */
    @Transactional
    public ReminderResponse complete(Long id, LocalDate date, Long userId) {
        Reminder r = reminders.findById(id).orElseThrow(NotFound::new);
        checkOccurrence(r, date);
        if (completions.findByReminderIdAndOccurrenceDate(id, date).isEmpty()) {
            completions.save(ReminderCompletion.builder().reminderId(id).occurrenceDate(date)
                    .userId(userId).completedAt(nowLocal()).build());
            log.info("Reminder {} for {} marked done by user {}", r.getName(), date, userId);
        }
        return responseFor(r);
    }

    /** Takes a completion back (Home's Undo): the occurrence shows again while its window lasts. */
    @Transactional
    public ReminderResponse undo(Long id, LocalDate date, Long userId) {
        Reminder r = reminders.findById(id).orElseThrow(NotFound::new);
        completions.findByReminderIdAndOccurrenceDate(id, date).ifPresent(c -> {
            completions.delete(c);
            log.info("Reminder {} for {} un-done by user {}", r.getName(), date, userId);
        });
        return responseFor(r);
    }

    private void checkOccurrence(Reminder r, LocalDate date) {
        if (date == null) throw new IllegalArgumentException("Which day? Send the occurrence date, like 2026-11-13");
        if (!rule(r).occursOn(date)) throw new IllegalArgumentException("That reminder isn't due on " + date);
        Instant over = instant(ReminderSchedule.dueAt(date, r.getDueBy())).plus(COMPLETE_GRACE);
        if (!clock.instant().isBefore(over)) throw new IllegalArgumentException("That day is already over");
    }

    // ── Alerts ──

    /**
     * Heads-ups whose time has come and that haven't been handled, for occurrences that aren't
     * over or done. After downtime several may be due for one occurrence: only the latest is
     * sent ({@link PendingAlert#sendKey}), the rest are recorded as passed over. An occurrence
     * already over is never alerted, so a long outage can't end in a flood of stale alerts.
     */
    public List<PendingAlert> pendingAlerts(Instant now) {
        List<Reminder> on = reminders.findByAlertsEnabledTrue();
        if (on.isEmpty()) return List.of();
        Map<Long, Map<LocalDate, ReminderCompletion>> done = completionsAhead(now);
        List<PendingAlert> out = new ArrayList<>();
        for (Reminder r : on) {
            List<HeadsUp> headsUps = ReminderSchedule.split(r.getHeadsUps());
            if (headsUps.isEmpty()) continue;
            Instant from = instant(r.getAlertsFrom() != null ? r.getAlertsFrom() : r.getCreatedAt());
            Map<LocalDate, ReminderCompletion> mine = done.getOrDefault(r.getId(), Map.of());
            for (LocalDate d : ReminderSchedule.upcoming(rule(r), r.getDueBy(), now, ReminderSchedule.LOOKAHEAD)) {
                // Later occurrences open later still.
                if (instant(ReminderSchedule.showFrom(d, headsUps)).isAfter(now)) break;
                if (mine.containsKey(d)) continue;
                List<HeadsUp> due = ReminderSchedule.dueHeadsUps(d, headsUps, from, now);
                if (due.isEmpty()) continue;
                Set<String> handled = alerts.findByReminderIdAndOccurrenceDate(r.getId(), d).stream()
                        .map(ReminderAlertSent::getHeadsUpKey).collect(Collectors.toSet());
                List<String> pending = due.stream().map(HeadsUp::key).filter(k -> !handled.contains(k)).toList();
                if (pending.isEmpty()) continue;
                out.add(new PendingAlert(r.getId(), d, pending, pending.get(pending.size() - 1)));
            }
        }
        return out;
    }

    /**
     * Records the heads-up(s) and alerts the household, in one transaction: the unique key on
     * (reminder, date, heads-up) makes a second attempt fail and roll back, and a failure to
     * create the alerts rolls the record back so the next minute tries again. Phone pushes go
     * out after the commit (PushService). Returns false when nothing was sent (the reminder
     * is gone, its alerts were turned off, or the occurrence was done meanwhile).
     */
    @Transactional
    public boolean send(PendingAlert p, Instant now) {
        Reminder r = reminders.findById(p.reminderId()).orElse(null);
        if (r == null || !r.isAlertsEnabled()) return false;
        if (completions.findByReminderIdAndOccurrenceDate(r.getId(), p.date()).isPresent()) return false;
        LocalDateTime at = LocalDateTime.ofInstant(now, HOME);
        for (String key : p.keys()) {
            alerts.saveAndFlush(ReminderAlertSent.builder().reminderId(r.getId()).occurrenceDate(p.date())
                    .headsUpKey(key).sent(key.equals(p.sendKey())).sentAt(at).build());
        }
        String title = "Reminder: " + r.getName();
        String body = ReminderSchedule.message(p.date(), r.getDueBy(), r.getNote(), at.toLocalDate());
        int reached = 0;
        for (Long userId : recipients()) {
            if (notifications.send(userId, AlertType.REMINDER, Severity.INFO, title, body) != null) reached++;
        }
        log.info("Reminder heads-up {} for {} ({}): {} member(s)", r.getName(), p.date(), p.sendKey(), reached);
        return true;
    }

    /** Active members (not guests) who haven't turned reminder alerts off. */
    private List<Long> recipients() {
        List<Long> members = users.findByStatus(User.AccountStatus.ACTIVE).stream()
                .filter(u -> u.getRole() != User.Role.GUEST)
                .map(User::getId)
                .toList();
        return notifications.wanting(members, AlertType.REMINDER);
    }

    // ── Validation ──

    /** Checks a request and reads it into a {@link Spec}; IllegalArgumentException with a plain message otherwise. */
    static Spec validate(ReminderRequest req, LocalDate today, LocalDate existingDate) {
        if (req == null) throw new IllegalArgumentException("Nothing to save");
        String name = req.name() == null ? "" : req.name().trim().replaceAll("\\s+", " ");
        if (name.isEmpty()) throw new IllegalArgumentException("Give the reminder a name");
        if (name.length() > NAME_MAX) throw new IllegalArgumentException("Keep the name to " + NAME_MAX + " characters");
        String note = req.note() == null ? null : req.note().trim();
        if (note != null && note.isEmpty()) note = null;
        if (note != null && note.length() > NOTE_MAX) throw new IllegalArgumentException("Keep the note to " + NOTE_MAX + " characters");

        Repeat repeat = Arrays.stream(Repeat.values())
                .filter(v -> v.name().equalsIgnoreCase(req.repeat() == null ? "" : req.repeat().trim()))
                .findFirst().orElseThrow(() -> new IllegalArgumentException("Choose how often it repeats"));
        Rule rule = switch (repeat) {
            case WEEKLY -> {
                if (req.weekdays() == null || req.weekdays().isEmpty()) {
                    throw new IllegalArgumentException("Pick at least one day of the week");
                }
                yield Rule.weekly(weekdays(req.weekdays()));
            }
            case MONTHLY -> {
                if (req.dayOfMonth() == null || req.dayOfMonth() < 1 || req.dayOfMonth() > 31) {
                    throw new IllegalArgumentException("Pick a day of the month from 1 to 31");
                }
                yield Rule.monthly(req.dayOfMonth());
            }
            case ONCE -> {
                LocalDate d;
                try {
                    d = req.date() == null ? null : LocalDate.parse(req.date().trim());
                } catch (DateTimeParseException e) {
                    d = null;
                }
                if (d == null) throw new IllegalArgumentException("Pick a date");
                // A one-time reminder that's already past may keep its date while it's edited.
                if (d.isBefore(today) && !d.equals(existingDate)) throw new IllegalArgumentException("That date has already passed");
                yield Rule.once(d);
            }
        };

        LocalTime dueBy = blank(req.dueBy()) ? null : parseTime(req.dueBy());

        List<ReminderRequest.HeadsUp> asked = req.headsUps() == null ? List.of() : req.headsUps();
        if (asked.size() > MAX_HEADS_UPS) throw new IllegalArgumentException("Pick up to " + MAX_HEADS_UPS + " heads-ups");
        List<HeadsUp> headsUps = new ArrayList<>();
        for (ReminderRequest.HeadsUp h : asked) {
            if (h == null) continue;
            HeadsUpKind kind = HeadsUpKind.of(h.kind()).orElseThrow(() -> new IllegalArgumentException("Unknown heads-up: " + h.kind()));
            HeadsUp parsed = switch (kind) {
                case DAYS_BEFORE -> {
                    if (h.days() == null) throw new IllegalArgumentException("Say how many days before");
                    yield HeadsUp.daysBefore(h.days(), blank(h.time()) ? null : parseTime(h.time()));
                }
                case AT_TIME -> HeadsUp.atTime(blank(h.time()) ? null : parseTime(h.time()));
                default -> HeadsUp.preset(kind);
            };
            if (dueBy != null && parsed.daysBefore() == 0 && !parsed.time().isBefore(dueBy)) {
                throw new IllegalArgumentException("The heads-up at " + ReminderSchedule.clock(parsed.time())
                        + " comes after the " + ReminderSchedule.clock(dueBy) + " done-by time");
            }
            headsUps.add(parsed);
        }
        return new Spec(name, note, rule, dueBy, ReminderSchedule.sorted(headsUps), req.alerts());
    }

    private static Set<DayOfWeek> weekdays(Collection<String> names) {
        Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
        for (String n : names) {
            String s = n == null ? "" : n.trim().toUpperCase();
            DayOfWeek d = Arrays.stream(DayOfWeek.values())
                    .filter(w -> s.length() >= 3 && w.name().startsWith(s))
                    .findFirst().orElseThrow(() -> new IllegalArgumentException("Unknown day of the week: " + n));
            days.add(d);
        }
        return days;
    }

    private static LocalTime parseTime(String s) {
        try {
            return LocalTime.parse(s.trim()).withSecond(0).withNano(0);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("Times look like 08:00");
        }
    }

    private static boolean blank(String s) {
        return s == null || s.isBlank();
    }

    private static void apply(Reminder r, Spec s, Long userId, LocalDateTime now) {
        r.setName(s.name());
        r.setNote(s.note());
        r.setRepeatKind(s.rule().repeat().name());
        r.setWeekdays(s.rule().repeat() == Repeat.WEEKLY ? s.rule().weekdays().stream()
                .sorted().map(d -> d.name().substring(0, 3)).collect(Collectors.joining(",")) : null);
        r.setDayOfMonth(s.rule().dayOfMonth());
        r.setOnceDate(s.rule().date());
        r.setDueBy(s.dueBy());
        r.setHeadsUps(ReminderSchedule.join(s.headsUps()));
        if (s.alerts() != null) r.setAlertsEnabled(s.alerts());
        else if (r.getId() == null) r.setAlertsEnabled(true);
        // Heads-ups due before this edit aren't sent: nobody needs a 6 PM alert set up at 7 PM.
        r.setAlertsFrom(now);
        r.setUpdatedBy(userId);
        r.setUpdatedAt(now);
    }

    // ── Responses ──

    static Rule rule(Reminder r) {
        Repeat repeat = Repeat.valueOf(r.getRepeatKind());
        return switch (repeat) {
            case WEEKLY -> Rule.weekly(r.getWeekdays() == null || r.getWeekdays().isBlank()
                    ? List.of() : weekdays(List.of(r.getWeekdays().split(","))));
            case MONTHLY -> Rule.monthly(r.getDayOfMonth() == null ? 1 : r.getDayOfMonth());
            case ONCE -> Rule.once(r.getOnceDate());
        };
    }

    private ReminderResponse responseFor(Reminder r) {
        Instant now = clock.instant();
        Map<LocalDate, ReminderCompletion> done = completionsAhead(now).getOrDefault(r.getId(), Map.of());
        Map<Long, String> names = names(Stream.of(r.getCreatedBy()), Map.of(r.getId() == null ? -1L : r.getId(), done));
        return response(r, done, names, now);
    }

    private ReminderResponse response(Reminder r, Map<LocalDate, ReminderCompletion> done, Map<Long, String> names, Instant now) {
        List<HeadsUp> headsUps = ReminderSchedule.split(r.getHeadsUps());
        Rule rule = rule(r);
        List<LocalDate> ahead = ReminderSchedule.upcoming(rule, r.getDueBy(), now, ReminderSchedule.LOOKAHEAD);
        ReminderResponse.Occurrence current = null;
        ReminderResponse.Occurrence next = null;
        if (!ahead.isEmpty()) {
            LocalDate first = ahead.get(0);
            current = occurrence(r, first, headsUps, done.get(first), names, now);
            if (done.containsKey(first)) {
                LocalDate open = ahead.stream().filter(d -> !done.containsKey(d)).findFirst().orElse(null);
                if (open != null) next = occurrence(r, open, headsUps, null, names, now);
            }
        }
        return new ReminderResponse(r.getId(), r.getName(), r.getNote(), r.getRepeatKind(),
                rule.repeat() == Repeat.WEEKLY ? rule.weekdays().stream().sorted().map(d -> d.name().substring(0, 3)).toList() : List.of(),
                r.getDayOfMonth(), r.getOnceDate() == null ? null : r.getOnceDate().toString(), time(r.getDueBy()),
                headsUps.stream().map(h -> new ReminderResponse.HeadsUp(h.key(), h.kind().name(), h.kind().label(),
                        h.daysBefore(), time(h.time()))).toList(),
                r.isAlertsEnabled(), current, next, names.get(r.getCreatedBy()),
                r.getUpdatedAt() == null ? null : r.getUpdatedAt().format(MOMENT));
    }

    private static ReminderResponse.Occurrence occurrence(Reminder r, LocalDate d, List<HeadsUp> headsUps,
                                                          ReminderCompletion c, Map<Long, String> names, Instant now) {
        return new ReminderResponse.Occurrence(d.toString(),
                ReminderSchedule.showFrom(d, headsUps).format(MOMENT),
                ReminderSchedule.dueAt(d, r.getDueBy()).format(MOMENT),
                c == null && ReminderSchedule.inWindow(d, r.getDueBy(), headsUps, now),
                c != null,
                c == null ? null : names.get(c.getUserId()),
                c == null ? null : c.getCompletedAt().format(MOMENT));
    }

    /** Completions of occurrences not yet over (today or later), by reminder and date. */
    private Map<Long, Map<LocalDate, ReminderCompletion>> completionsAhead(Instant now) {
        Map<Long, Map<LocalDate, ReminderCompletion>> out = new HashMap<>();
        for (ReminderCompletion c : completions.findByOccurrenceDateGreaterThanEqual(ReminderSchedule.homeDate(now))) {
            out.computeIfAbsent(c.getReminderId(), k -> new HashMap<>()).put(c.getOccurrenceDate(), c);
        }
        return out;
    }

    /** Display names for creators and completers. */
    private Map<Long, String> names(Stream<Long> creators, Map<Long, Map<LocalDate, ReminderCompletion>> done) {
        Set<Long> ids = new HashSet<>();
        creators.filter(Objects::nonNull).forEach(ids::add);
        done.values().forEach(m -> m.values().stream().map(ReminderCompletion::getUserId).filter(Objects::nonNull).forEach(ids::add));
        if (ids.isEmpty()) return Map.of();
        return users.findAllById(ids).stream().collect(Collectors.toMap(User::getId, ReminderService::displayName, (a, b) -> a));
    }

    private static String displayName(User u) {
        return u.getDisplayName() != null && !u.getDisplayName().isBlank() ? u.getDisplayName() : u.getUsername();
    }

    private LocalDateTime nowLocal() {
        return LocalDateTime.ofInstant(clock.instant(), HOME).withSecond(0).withNano(0);
    }

    private static String time(LocalTime t) {
        return t == null ? null : t.format(HH_MM);
    }
}
