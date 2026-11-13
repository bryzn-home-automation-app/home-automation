package com.homeplatform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.RoombaScheduleSkipResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.RoombaCommand;
import com.homeplatform.model.RoombaNativeSchedule;
import com.homeplatform.model.RoombaScheduleSkip;
import com.homeplatform.model.RoombaStatus;
import com.homeplatform.model.User;
import com.homeplatform.repository.RoombaCommandRepository;
import com.homeplatform.repository.RoombaNativeScheduleRepository;
import com.homeplatform.repository.RoombaScheduleSkipRepository;
import com.homeplatform.repository.RoombaStatusRepository;
import com.homeplatform.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.time.format.TextStyle;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Set;

/**
 * Skipping one of the robot's scheduled cleans (today's or tomorrow's). The schedules live in
 * iRobot's cloud, which has no "skip once", so a skip is a {@link RoombaScheduleSkip} row the
 * poller works through: it switches that schedule off across the skipped start and back on
 * {@link #RESTORE_AFTER} later, retrying until it is (roomba-poller/schedule_skips.py). This
 * side checks the request against the mirrored schedule, records it, wakes the poller with a
 * command row, and tells the admins when a skip couldn't be made or a schedule wasn't
 * switched back on: the one failure that must not go unnoticed.
 */
@Service
public class RoombaScheduleSkipService {

    private static final Logger log = LoggerFactory.getLogger(RoombaScheduleSkipService.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    /** The robot's schedule times are the home's clock. */
    static final ZoneId HOME = ZoneId.of("America/Chicago");
    /** The poller switches the schedule back on this long after the skipped start. */
    static final Duration RESTORE_AFTER = Duration.ofMinutes(30);
    /** A clean starting sooner than this is too close to skip: the change may not reach the robot. */
    static final Duration TOO_SOON = Duration.ofMinutes(2);
    /** Still not switched off this long after the start: tell the admins it wasn't skipped. */
    static final Duration NOT_SKIPPED_ALERT = Duration.ofMinutes(10);
    /** Still off this long after it should have gone back on: tell the admins. */
    static final Duration STILL_OFF_ALERT = Duration.ofHours(1);
    /** Settled skips stay on the page this long. */
    static final Duration RECENT = Duration.ofDays(2);

    static final String PENDING = "PENDING";
    static final String APPLYING = "APPLYING";
    static final String APPLIED = "APPLIED";
    static final String RESTORED = "RESTORED";
    static final String CANCELLED = "CANCELLED";
    static final String FAILED = "FAILED";
    static final List<String> ACTIVE = List.of(PENDING, APPLYING, APPLIED);

    /** Command rows that wake the poller for a skip pass (roomba-poller/poller.py SKIP_CLEAN, UNDO_SKIP). */
    static final String SKIP_COMMAND = "skip_clean";
    static final String UNDO_COMMAND = "undo_skip";

    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("h:mm a", Locale.US);

    private final RoombaScheduleSkipRepository skips;
    private final RoombaNativeScheduleRepository schedules;
    private final RoombaCommandRepository commands;
    private final RoombaStatusRepository status;
    private final NotificationService notifications;
    private final UserRepository users;
    private final Clock clock;

    @Autowired
    public RoombaScheduleSkipService(RoombaScheduleSkipRepository skips, RoombaNativeScheduleRepository schedules,
                                     RoombaCommandRepository commands, RoombaStatusRepository status,
                                     NotificationService notifications, UserRepository users) {
        this(skips, schedules, commands, status, notifications, users, Clock.systemUTC());
    }

    RoombaScheduleSkipService(RoombaScheduleSkipRepository skips, RoombaNativeScheduleRepository schedules,
                              RoombaCommandRepository commands, RoombaStatusRepository status,
                              NotificationService notifications, UserRepository users, Clock clock) {
        this.skips = skips;
        this.schedules = schedules;
        this.commands = commands;
        this.status = status;
        this.notifications = notifications;
        this.users = users;
        this.clock = clock;
    }

    /** Skips still under way and those settled in the last {@link #RECENT}, newest start first. */
    public List<RoombaScheduleSkipResponse> recent() {
        return skips.findRecent(ACTIVE, utc(clock.instant().minus(RECENT))).stream()
                .limit(20)
                .map(RoombaScheduleSkipService::toResponse)
                .toList();
    }

    /**
     * Skip the clean {@code householdScheduleId} would start on {@code date} (today or tomorrow
     * at home). Checked against the schedule as last read from the cloud; the poller checks it
     * again against the cloud's current copy before switching anything off.
     */
    @Transactional
    public RoombaScheduleSkipResponse skip(String householdScheduleId, String date, String requestedBy) {
        if (householdScheduleId == null || householdScheduleId.isBlank()) {
            throw new IllegalArgumentException("Pick the schedule whose clean to skip");
        }
        LocalDate day;
        try {
            day = LocalDate.parse(date == null ? "" : date.trim());
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("date must be YYYY-MM-DD");
        }
        String id = householdScheduleId.trim();
        RoombaNativeSchedule schedule = schedules.findAllByOrderByIdAsc().stream()
                .filter(s -> id.equals(s.getHouseholdScheduleId()))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "That schedule isn't in the iRobot app any more. Refresh the schedules and try again."));
        JsonNode options = parse(schedule.getOptions());
        JsonNode start = options.path("start");
        if (!start.path("hour").canConvertToInt() || !start.path("min").canConvertToInt()) {
            throw new IllegalArgumentException("That schedule has no start time.");
        }
        int hour = start.get("hour").asInt();
        int minute = start.get("min").asInt();
        Set<Integer> days = new HashSet<>();
        for (JsonNode d : start.path("day")) {
            if (d.canConvertToInt()) days.add(d.asInt());
        }

        Instant now = clock.instant();
        LocalDate today = LocalDate.ofInstant(now, HOME);
        if (!day.equals(today) && !day.equals(today.plusDays(1))) {
            throw new IllegalArgumentException("Only today's or tomorrow's clean can be skipped.");
        }
        if (!runsOn(days, day)) {
            throw new IllegalArgumentException("That schedule doesn't clean on "
                    + day.getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.US) + ".");
        }
        // Off because of an earlier skip of ours counts as on: that one switches it back.
        List<RoombaScheduleSkip> active = skips.findByHouseholdScheduleIdAndStateIn(id, ACTIVE);
        if (!options.path("enabled").asBoolean(false) && active.isEmpty()) {
            throw new IllegalArgumentException("That schedule is switched off, so there's no clean to skip.");
        }
        if (active.stream().anyMatch(s -> day.equals(s.getSkipDate()) && s.getUndoRequestedAt() == null)) {
            throw new IllegalArgumentException("That clean is already skipped.");
        }
        Instant startsAt;
        try {
            startsAt = ZonedDateTime.of(day, LocalTime.of(hour, minute), HOME).toInstant();
        } catch (DateTimeException e) {
            throw new IllegalArgumentException("That schedule's start time can't be read.");
        }
        if (!startsAt.isAfter(now)) {
            throw new IllegalArgumentException("That clean has already started.");
        }
        if (startsAt.isBefore(now.plus(TOO_SOON))) {
            throw new IllegalArgumentException("That clean starts in under two minutes, too soon to skip.");
        }

        LocalDateTime at = utc(now);
        String robotId = schedule.getRobotId() != null ? schedule.getRobotId()
                : status.findTopByOrderByUpdatedAtDesc().map(RoombaStatus::getRobotId).orElse(null);
        RoombaScheduleSkip saved = skips.save(RoombaScheduleSkip.builder()
                .robotId(robotId)
                .householdScheduleId(id)
                .scheduleId(options.hasNonNull("schedule_id") ? options.get("schedule_id").asText() : null)
                .skipDate(day)
                .scheduleHour(hour)
                .scheduleMinute(minute)
                .scheduledFor(utc(startsAt))
                .restoreAfter(utc(startsAt.plus(RESTORE_AFTER)))
                .state(PENDING)
                .requestedBy(requestedBy)
                .createdAt(at)
                .nextCheckAt(at)
                .attempts(0)
                .updatedAt(at)
                .build());
        wake(SKIP_COMMAND, saved, requestedBy);
        log.info("Roomba: skip #{} of {} asked for by {}", saved.getId(), cleanName(saved), requestedBy);
        return toResponse(saved);
    }

    /**
     * Undo a skip still under way. The poller does it: drops one not yet switched off, or
     * switches the schedule back on now. Only the undo columns are written (see the repository).
     */
    @Transactional
    public RoombaScheduleSkipResponse undo(Long skipId, String requestedBy) {
        RoombaScheduleSkip s = skips.findById(skipId).orElseThrow(() -> new NoSuchElementException("No such skip"));
        if (!ACTIVE.contains(s.getState())) {
            throw new IllegalStateException("That skip has already ended.");
        }
        if (s.getUndoRequestedAt() == null && skips.requestUndo(skipId, utc(clock.instant()), requestedBy, ACTIVE) > 0) {
            wake(UNDO_COMMAND, s, requestedBy);
            log.info("Roomba: skip #{} undone by {}", skipId, requestedBy);
        }
        return toResponse(skips.findById(skipId).orElse(s));
    }

    private void wake(String command, RoombaScheduleSkip s, String requestedBy) {
        commands.save(RoombaCommand.builder()
                .robotId(s.getRobotId())
                .command(command)
                .arg(String.valueOf(s.getId()))
                .status("PENDING")
                .requestedBy(requestedBy)
                .createdAt(utc(clock.instant()))
                .build());
    }

    // ── Alerts ──────────────────────────────────────────────────────────

    /** A skip that couldn't be made, or a schedule left off: tell the admins, once per skip. */
    @Scheduled(initialDelay = 300_000, fixedDelay = 60_000)
    public void checkFailures() {
        try {
            alertFailures();
        } catch (Exception e) {
            log.warn("Roomba skip alert check failed: {}", e.getMessage());
        }
    }

    void alertFailures() {
        LocalDateTime now = utc(clock.instant());
        for (RoombaScheduleSkip s : skips.findByAlertedAtIsNullAndStateIn(List.of(PENDING, APPLYING, APPLIED, FAILED))) {
            Alert alert = alertFor(s, now);
            if (alert == null || skips.markAlerted(s.getId(), now) == 0) continue;
            log.warn("Roomba skip #{}: {}", s.getId(), alert.title());
            for (User admin : users.findByRoleAndStatus(User.Role.ADMIN, User.AccountStatus.ACTIVE)) {
                try {
                    notifications.send(admin.getId(), AlertType.ROOMBA_ERROR, alert.severity(), alert.title(), alert.message());
                } catch (Exception e) {
                    log.warn("Couldn't send the skip alert to user {}: {}", admin.getId(), e.getMessage());
                }
            }
        }
    }

    record Alert(Severity severity, String title, String message) {}

    /** The alert a skip needs now, or null. */
    static Alert alertFor(RoombaScheduleSkip s, LocalDateTime now) {
        String why = s.getLastError() != null && !s.getLastError().isBlank() ? " (" + s.getLastError() + ")" : "";
        String state = s.getState();
        boolean notSkipped = FAILED.equals(state)
                || (PENDING.equals(state) && s.getUndoRequestedAt() == null
                    && now.isAfter(s.getScheduledFor().plus(NOT_SKIPPED_ALERT)));
        if (notSkipped) {
            return new Alert(Severity.WARNING, "Couldn't skip the Roomba's clean",
                    capitalize(cleanName(s)) + " was to be skipped, but its schedule couldn't be switched off in time"
                            + why + ", so the robot may have cleaned as usual.");
        }
        if (APPLIED.equals(state) || APPLYING.equals(state)) {
            LocalDateTime due = s.getRestoreAfter();
            if (s.getUndoRequestedAt() != null && s.getUndoRequestedAt().isBefore(due)) {
                due = s.getUndoRequestedAt();
            }
            if (now.isAfter(due.plus(STILL_OFF_ALERT))) {
                return new Alert(Severity.CRITICAL, "A Roomba schedule may still be off",
                        "Skipping " + cleanName(s) + " switched its schedule off in the iRobot app, and it hasn't been"
                                + " switched back on" + why + ". Turn it back on in the iRobot app, or its next cleans"
                                + " won't run. The home app keeps trying meanwhile.");
            }
        }
        return null;
    }

    /** "Tuesday's 9:00 AM clean". */
    static String cleanName(RoombaScheduleSkip s) {
        String day = s.getSkipDate().getDayOfWeek().getDisplayName(TextStyle.FULL, Locale.US);
        return day + "'s " + LocalTime.of(s.getScheduleHour(), s.getScheduleMinute()).format(TIME) + " clean";
    }

    private static String capitalize(String text) {
        return text.isEmpty() ? text : Character.toUpperCase(text.charAt(0)) + text.substring(1);
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    /**
     * Whether a schedule with these start days runs on {@code day}. iRobot counts 0 = Sunday …
     * 6 = Saturday; Sunday is also taken as 7 (this app was written for ISO numbers, and no
     * Sunday schedule has been seen yet). Monday to Saturday agree either way.
     */
    static boolean runsOn(Set<Integer> days, LocalDate day) {
        int wd = day.getDayOfWeek().getValue() % 7;
        return days.contains(wd) || (wd == 0 && days.contains(7));
    }

    private static JsonNode parse(String raw) {
        try {
            JsonNode node = raw == null ? null : mapper.readTree(raw);
            return node == null ? mapper.createObjectNode() : node;
        } catch (Exception e) {
            return mapper.createObjectNode();
        }
    }

    private static LocalDateTime utc(Instant instant) {
        return LocalDateTime.ofInstant(instant, ZoneOffset.UTC);
    }

    private static String iso(LocalDateTime dt) {
        return dt == null ? null : dt.atOffset(ZoneOffset.UTC).toString();
    }

    static RoombaScheduleSkipResponse toResponse(RoombaScheduleSkip s) {
        return new RoombaScheduleSkipResponse(
                s.getId(), s.getHouseholdScheduleId(), s.getScheduleId(),
                s.getSkipDate() == null ? null : s.getSkipDate().toString(),
                s.getScheduleHour() == null ? 0 : s.getScheduleHour(),
                s.getScheduleMinute() == null ? 0 : s.getScheduleMinute(),
                iso(s.getScheduledFor()), iso(s.getRestoreAfter()), s.getState(), s.getDetail(), s.getLastError(),
                s.getUndoRequestedAt() != null, s.getRequestedBy(),
                iso(s.getCreatedAt()), iso(s.getAppliedAt()), iso(s.getFinishedAt()));
    }
}
