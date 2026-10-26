package com.homeplatform.homeassistant;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.CameraBatteryReading;
import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.User;
import com.homeplatform.repository.CameraBatteryReadingRepository;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.NotificationRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.service.NotificationService;
import com.homeplatform.service.WeatherService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CameraAlertServiceTest {

    // 2 PM in Dallas
    private static final Instant NOW = Instant.parse("2026-10-20T19:00:00Z");
    private static final LocalDateTime UTC_NOW = LocalDateTime.ofInstant(NOW, ZoneOffset.UTC);

    private SmartDeviceRepository deviceRepo;
    private CameraStatusRepository statusRepo;
    private CameraBatteryReadingRepository readingRepo;
    private NotificationRepository notificationRepo;
    private NotificationService notifications;
    private UserRepository users;
    private WeatherService weather;
    private CameraAlertService service;

    private final SmartDevice front = cam(1L, "Front");
    private final SmartDevice backyard = cam(2L, "Backyard");
    private CameraStatus frontStatus;
    private CameraStatus backyardStatus;
    /** "user|title" already sent — what the notifications table would hold. */
    private final List<String> sent = new ArrayList<>();

    private static SmartDevice cam(long id, String name) {
        return SmartDevice.builder().id(id).publicId(UUID.randomUUID()).name(name)
                .providerEntityId("camera." + name.toLowerCase()).kind(SmartDevice.Kind.CAMERA).enabled(true).build();
    }

    private static User user(long id, User.Role role) {
        User u = new User();
        u.setId(id);
        u.setRole(role);
        return u;
    }

    @BeforeEach
    void setUp() {
        deviceRepo = mock(SmartDeviceRepository.class);
        statusRepo = mock(CameraStatusRepository.class);
        readingRepo = mock(CameraBatteryReadingRepository.class);
        notificationRepo = mock(NotificationRepository.class);
        notifications = mock(NotificationService.class);
        users = mock(UserRepository.class);
        when(notifications.wanting(anyList(), any())).thenAnswer(i -> i.getArgument(0));
        weather = mock(WeatherService.class);
        service = new CameraAlertService(deviceRepo, statusRepo, readingRepo, notificationRepo, notifications, users,
                weather, mock(com.homeplatform.service.PresenceService.class), 32.78, -96.80,
                Clock.fixed(NOW, ZoneId.of("America/Chicago")));

        frontStatus = battery(1L, 80.0);
        backyardStatus = battery(2L, 80.0);
        when(deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA)).thenReturn(List.of(backyard, front));
        when(statusRepo.findByDeviceId(1L)).thenAnswer(i -> java.util.Optional.of(frontStatus));
        when(statusRepo.findByDeviceId(2L)).thenAnswer(i -> java.util.Optional.of(backyardStatus));
        // Two members and a guest; guests never get camera alerts.
        when(users.findByStatus(User.AccountStatus.ACTIVE))
                .thenReturn(List.of(user(10L, User.Role.ADMIN), user(11L, User.Role.USER), user(12L, User.Role.GUEST)));
        when(notificationRepo.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(anyLong(), eq(Category.CAMERA), anyString(), any()))
                .thenAnswer(i -> sent.contains(i.getArgument(0, Long.class) + "|" + i.getArgument(2, String.class)));
        when(notifications.send(anyLong(), any(AlertType.class), any(), anyString(), anyString())).thenAnswer(i -> {
            sent.add(i.getArgument(0, Long.class) + "|" + i.getArgument(3, String.class));
            return null;
        });
        when(readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(anyLong(), any(), any())).thenReturn(List.of());
    }

    private static CameraStatus battery(long deviceId, double pct) {
        return CameraStatus.builder().deviceId(deviceId).available(true).powerSource(CameraStatus.POWER_BATTERY)
                .batteryPercent(pct).charging(false).build();
    }

    private static CameraBatteryReading reading(LocalDateTime at, double pct, Boolean charging) {
        return CameraBatteryReading.builder().recordedAt(at).batteryPercent(pct).charging(charging).build();
    }

    private void weatherCodes(int dayBefore, int yesterday) {
        LocalDate today = LocalDate.of(2026, 10, 20);
        when(weather.getWeatherForDateRange(anyDouble(), anyDouble(), any(), any())).thenReturn(new WeatherResponse(0, 0, null,
                List.of(new WeatherResponse.WeatherDay(today.minusDays(2).toString(), 60, 80, 70, 0, dayBefore),
                        new WeatherResponse.WeatherDay(today.minusDays(1).toString(), 60, 80, 70, 0, yesterday)),
                List.of(), null));
    }

    @Test
    @DisplayName("battery low (≤30%) warns members once a day; critical (≤15%) is CRITICAL")
    void batteryLevels() {
        frontStatus.setBatteryPercent(28.0);
        backyardStatus.setBatteryPercent(12.0);

        service.evaluate();
        service.evaluate(); // a later tick the same day

        verify(notifications).send(eq(10L), eq(AlertType.CAMERA_BATTERY), eq(Severity.WARNING), eq("Front camera battery low"), contains("28%"));
        verify(notifications).send(eq(10L), eq(AlertType.CAMERA_BATTERY), eq(Severity.CRITICAL), eq("Backyard camera battery critical"), contains("12%"));
        verify(notifications, never()).send(eq(12L), any(), any(), any(), any());
        // 2 alerts × 2 members, not repeated by the second tick.
        verify(notifications, times(4)).send(anyLong(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("no battery alert while charging, or for wired cameras")
    void chargingOrWired() {
        frontStatus.setBatteryPercent(10.0);
        frontStatus.setCharging(true);
        backyardStatus.setPowerSource(CameraStatus.POWER_WIRED);
        backyardStatus.setBatteryPercent(5.0);
        service.evaluate();
        verify(notifications, never()).send(anyLong(), any(), any(), anyString(), anyString());
    }

    @Test
    @DisplayName("not charging: two sunny days with no gain below 90% → warning")
    void notChargingOnSunnyDays() {
        frontStatus.setBatteryPercent(70.0);
        when(readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(eq(1L), any(), any())).thenReturn(List.of(
                reading(UTC_NOW.minusHours(47), 76, false),
                reading(UTC_NOW.minusHours(24), 73, false),
                reading(UTC_NOW.minusHours(1), 70, false)));
        weatherCodes(0, 1);

        service.evaluate();

        verify(notifications).send(eq(10L), eq(AlertType.CAMERA_NOT_CHARGING), eq(Severity.WARNING), eq("Front camera isn't charging"), contains("panel"));
    }

    @Test
    @DisplayName("a failed weather lookup is retried next tick, not cached for the day")
    void weatherFailureRetried() {
        frontStatus.setBatteryPercent(70.0);
        when(readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(eq(1L), any(), any())).thenReturn(List.of(
                reading(UTC_NOW.minusHours(47), 76, false), reading(UTC_NOW.minusHours(1), 70, false)));
        when(weather.getWeatherForDateRange(anyDouble(), anyDouble(), any(), any())).thenThrow(new RuntimeException("timeout"));
        service.evaluate();
        verify(notifications, never()).send(anyLong(), any(), any(), eq("Front camera isn't charging"), anyString());

        reset(weather);
        weatherCodes(1, 0);
        service.evaluate();
        verify(notifications).send(eq(10L), eq(AlertType.CAMERA_NOT_CHARGING), eq(Severity.WARNING), eq("Front camera isn't charging"), anyString());
    }

    @Test
    @DisplayName("not charging is skipped on cloudy days, after any gain, or with under 2 days of history")
    void notChargingGuards() {
        frontStatus.setBatteryPercent(70.0);
        var steadyDecline = List.of(reading(UTC_NOW.minusHours(47), 76, false), reading(UTC_NOW.minusHours(1), 70, false));
        when(readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(eq(1L), any(), any())).thenReturn(steadyDecline);

        weatherCodes(0, 3); // yesterday overcast
        service.evaluate();
        verify(notifications, never()).send(anyLong(), any(), any(), anyString(), anyString());

        assertTrue(CameraAlertService.gainedCharge(List.of(reading(UTC_NOW.minusHours(30), 70, false), reading(UTC_NOW.minusHours(20), 72, false))));
        assertTrue(CameraAlertService.gainedCharge(List.of(reading(UTC_NOW.minusHours(30), 70, true))));
        assertFalse(CameraAlertService.coversWindow(List.of(reading(UTC_NOW.minusHours(20), 70, false)), UTC_NOW), "camera added yesterday");
        assertFalse(CameraAlertService.coversWindow(List.of(), UTC_NOW));
    }

    @Test
    @DisplayName("offline: per camera after 30 min; all offline → one 'disconnected' alert")
    void offline() {
        frontStatus.setAvailable(false);
        frontStatus.setUnavailableSince(UTC_NOW.minusMinutes(45));
        service.evaluate();
        verify(notifications).send(eq(10L), eq(AlertType.CAMERA_OFFLINE), eq(Severity.WARNING), eq("Front camera offline"), anyString());

        reset(notifications);
        when(notifications.wanting(anyList(), any())).thenAnswer(i -> i.getArgument(0));
        sent.clear();
        backyardStatus.setAvailable(false);
        backyardStatus.setUnavailableSince(UTC_NOW.minusMinutes(10)); // not long enough yet
        service.evaluate();
        verify(notifications, never()).send(anyLong(), any(), any(), eq("Eufy cameras disconnected"), anyString());

        backyardStatus.setUnavailableSince(UTC_NOW.minusMinutes(40));
        service.evaluate();
        verify(notifications).send(eq(10L), eq(AlertType.CAMERA_OFFLINE), eq(Severity.WARNING), eq("Eufy cameras disconnected"), contains("signed out"));
    }

    @Test
    @DisplayName("person: outdoor cameras only, one per camera per 15 minutes")
    void person() {
        service.personDetected(front, frontStatus);
        service.personDetected(front, frontStatus);
        verify(notifications, times(2)).send(anyLong(), eq(AlertType.PERSON_DETECTED), eq(Severity.INFO), eq("Person detected — Front"), contains("2:00 PM"));

        SmartDevice living = cam(3L, "Living Room");
        CameraStatus wired = CameraStatus.builder().deviceId(3L).available(true).powerSource(CameraStatus.POWER_WIRED).build();
        service.personDetected(living, wired);
        verify(notifications, never()).send(anyLong(), any(), any(), eq("Person detected — Living Room"), anyString());
    }

    @Test
    @DisplayName("members who turned a type off aren't sent it, and nothing is checked when nobody wants it")
    void preferences() {
        when(notifications.wanting(anyList(), eq(AlertType.PERSON_DETECTED))).thenAnswer(i -> List.of(11L));
        service.personDetected(front, frontStatus);
        verify(notifications).send(eq(11L), eq(AlertType.PERSON_DETECTED), any(), anyString(), anyString());
        verify(notifications, never()).send(eq(10L), any(), any(), anyString(), anyString());

        when(notifications.wanting(anyList(), eq(AlertType.CAMERA_NOT_CHARGING))).thenReturn(List.of());
        frontStatus = battery(1L, 40.0);
        service.evaluate();
        verify(readingRepo, never()).findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(anyLong(), any(), any());
    }

    @Test
    @DisplayName("failures never escape (alerts must not break ingestion or the snapshot)")
    void neverThrows() {
        when(users.findByStatus(any())).thenThrow(new RuntimeException("db down"));
        assertDoesNotThrow(() -> service.evaluate());
        assertDoesNotThrow(() -> service.personDetected(front, frontStatus));
    }
}
