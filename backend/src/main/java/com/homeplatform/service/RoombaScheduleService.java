package com.homeplatform.service;

import com.homeplatform.dto.RoombaScheduleRequest;
import com.homeplatform.dto.RoombaScheduleResponse;
import com.homeplatform.model.RoombaSchedule;
import com.homeplatform.repository.RoombaScheduleRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * CRUD + validation for {@link RoombaSchedule}. Firing is handled separately by
 * {@link RoombaScheduleScheduler}; this service only manages the records and the
 * CSV ⇄ list conversions used for storage.
 */
@Service
public class RoombaScheduleService {

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");
    private static final int MAX_NAME = 120;

    static final String WHOLE_HOUSE = "WHOLE_HOUSE";
    static final String ROOMS = "ROOMS";

    private static final Set<String> SUCTION_LEVELS = Set.of("low", "medium", "high", "turbo");
    private static final Set<String> PASSES = Set.of("one", "two");
    private static final Set<String> MODES = Set.of("vacuum", "mop", "vacmop");

    private final RoombaScheduleRepository repo;

    public RoombaScheduleService(RoombaScheduleRepository repo) {
        this.repo = repo;
    }

    public List<RoombaScheduleResponse> list() {
        return repo.findAllByOrderByIdDesc().stream().map(RoombaScheduleService::toResponse).toList();
    }

    public RoombaScheduleResponse create(RoombaScheduleRequest req) {
        RoombaSchedule s = new RoombaSchedule();
        apply(s, req);
        s.setLastFiredAt(null);
        s.setCreatedAt(LocalDateTime.now(ZoneOffset.UTC));
        return toResponse(repo.save(s));
    }

    public RoombaScheduleResponse update(Long id, RoombaScheduleRequest req) {
        RoombaSchedule s = repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Schedule not found"));
        apply(s, req);
        return toResponse(repo.save(s));
    }

    /** Toggle enabled without touching the rest of the schedule. */
    public RoombaScheduleResponse setEnabled(Long id, boolean enabled) {
        RoombaSchedule s = repo.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Schedule not found"));
        s.setEnabled(enabled);
        return toResponse(repo.save(s));
    }

    public void delete(Long id) {
        if (!repo.existsById(id)) {
            throw new IllegalArgumentException("Schedule not found");
        }
        repo.deleteById(id);
    }

    // --- validation + mapping ---

    /** Validate the request and copy it onto the entity (create + update share this). */
    private void apply(RoombaSchedule s, RoombaScheduleRequest req) {
        if (req == null) {
            throw new IllegalArgumentException("request body is required");
        }

        String name = req.name() == null ? "" : req.name().trim();
        if (name.isEmpty()) {
            throw new IllegalArgumentException("name is required");
        }
        if (name.length() > MAX_NAME) {
            throw new IllegalArgumentException("name must be " + MAX_NAME + " characters or fewer");
        }

        String days = normalizeDays(req.daysOfWeek());
        LocalTime time = parseTime(req.time());
        String target = normalizeTarget(req.targetType());

        String roomIdsCsv = null;
        String roomLabelsCsv = null;
        if (ROOMS.equals(target)) {
            List<String> ids = cleanList(req.roomIds());
            if (ids.isEmpty()) {
                throw new IllegalArgumentException("Select at least one room for a room schedule");
            }
            roomIdsCsv = String.join(",", ids);
            List<String> labels = cleanList(req.roomLabels());
            roomLabelsCsv = labels.isEmpty() ? null : String.join(",", labels);
            if (roomIdsCsv.length() > 1024 || (roomLabelsCsv != null && roomLabelsCsv.length() > 1024)) {
                throw new IllegalArgumentException("Too many rooms selected");
            }
        }

        String suction = validateOption(req.suction(), SUCTION_LEVELS, "suction level");
        String passes = validateOption(req.passes(), PASSES, "passes");
        String mode = validateOption(req.mode(), MODES, "mode");

        s.setName(name);
        s.setEnabled(req.enabled() == null || req.enabled());
        s.setDaysOfWeek(days);
        s.setTimeOfDay(time);
        s.setTargetType(target);
        s.setRoomIds(roomIdsCsv);
        s.setRoomLabels(roomLabelsCsv);
        s.setSuction(suction);
        s.setPasses(passes);
        s.setMode(mode);
    }

    /** Distinct, sorted ISO day numbers (1-7) as a CSV; rejects empty/out-of-range. */
    private static String normalizeDays(List<Integer> days) {
        if (days == null || days.isEmpty()) {
            throw new IllegalArgumentException("Select at least one day");
        }
        Set<Integer> distinct = new java.util.TreeSet<>();
        for (Integer d : days) {
            if (d == null || d < 1 || d > 7) {
                throw new IllegalArgumentException("Day numbers must be 1 (Mon) through 7 (Sun)");
            }
            distinct.add(d);
        }
        List<String> parts = distinct.stream().map(String::valueOf).toList();
        return String.join(",", parts);
    }

    private static LocalTime parseTime(String time) {
        if (time == null || time.isBlank()) {
            throw new IllegalArgumentException("time is required (HH:mm)");
        }
        try {
            // Store to minute precision — the scheduler matches on hour + minute.
            return LocalTime.parse(time.trim(), HH_MM).withSecond(0).withNano(0);
        } catch (Exception e) {
            throw new IllegalArgumentException("time must be HH:mm (24-hour)");
        }
    }

    private static String normalizeTarget(String target) {
        String t = target == null ? "" : target.trim().toUpperCase();
        if (!WHOLE_HOUSE.equals(t) && !ROOMS.equals(t)) {
            throw new IllegalArgumentException("targetType must be WHOLE_HOUSE or ROOMS");
        }
        return t;
    }

    private static String validateOption(String value, Set<String> allowed, String label) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String v = value.trim().toLowerCase();
        if (!allowed.contains(v)) {
            throw new IllegalArgumentException("Unsupported " + label + ": " + value);
        }
        return v;
    }

    private static List<String> cleanList(List<String> values) {
        if (values == null) {
            return List.of();
        }
        List<String> out = new ArrayList<>(new LinkedHashSet<>(
                values.stream().filter(v -> v != null && !v.isBlank()).map(String::trim).toList()));
        return out;
    }

    static List<String> csvToStrings(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return Arrays.stream(csv.split(",")).map(String::trim).filter(v -> !v.isEmpty()).toList();
    }

    private static List<Integer> csvToDays(String csv) {
        return csvToStrings(csv).stream().map(Integer::valueOf).toList();
    }

    static RoombaScheduleResponse toResponse(RoombaSchedule s) {
        return new RoombaScheduleResponse(
                s.getId(),
                s.getName(),
                s.isEnabled(),
                csvToDays(s.getDaysOfWeek()),
                s.getTimeOfDay() == null ? null : s.getTimeOfDay().format(HH_MM),
                s.getTargetType(),
                csvToStrings(s.getRoomIds()),
                csvToStrings(s.getRoomLabels()),
                s.getSuction(),
                s.getPasses(),
                s.getMode(),
                iso(s.getLastFiredAt()),
                iso(s.getCreatedAt()));
    }

    private static String iso(LocalDateTime dt) {
        return dt == null ? null : dt.atOffset(ZoneOffset.UTC).toString();
    }
}
