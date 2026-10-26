package com.homeplatform.homeassistant;

import com.homeplatform.model.AlertType;
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
import com.homeplatform.service.PresenceService;
import com.homeplatform.service.WeatherService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.*;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** The indoor camera's alerts while everyone's away: a person inside, and sustained noise. */
class IndoorCameraAlertTest {

    private static final ZoneId CT = ZoneId.of("America/Chicago");

    /** A clock the test moves forward. */
    static final class MutableClock extends Clock {
        Instant now = Instant.parse("2026-10-26T06:00:00Z"); // 1:00 AM CT
        @Override public ZoneId getZone() { return CT; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void plus(Duration d) { now = now.plus(d); }
    }

    private final MutableClock clock = new MutableClock();
    private final List<String> sent = new ArrayList<>();
    private final SmartDevice living = SmartDevice.builder().id(3L).name("Living Room").providerEntityId("camera.living_room")
            .kind(SmartDevice.Kind.CAMERA).enabled(true).build();
    private final CameraStatus wired = CameraStatus.builder().deviceId(3L).available(true).powerSource(CameraStatus.POWER_WIRED).build();
    private final CameraStatus outdoor = CameraStatus.builder().deviceId(1L).available(true).powerSource(CameraStatus.POWER_BATTERY).build();
    private PresenceService presence;
    private NotificationService notifications;
    private CameraAlertService service;

    @BeforeEach
    void setUp() {
        presence = mock(PresenceService.class);
        notifications = mock(NotificationService.class);
        NotificationRepository notificationRepo = mock(NotificationRepository.class);
        UserRepository users = mock(UserRepository.class);
        User admin = new User();
        admin.setId(10L);
        admin.setRole(User.Role.ADMIN);
        when(users.findByStatus(User.AccountStatus.ACTIVE)).thenReturn(List.of(admin));
        when(notifications.wanting(anyList(), any())).thenAnswer(i -> i.getArgument(0));
        when(notifications.send(anyLong(), any(AlertType.class), any(), anyString(), anyString())).thenAnswer(i -> {
            sent.add(i.getArgument(3, String.class) + " | " + i.getArgument(4, String.class));
            return null;
        });
        // Dedupe against what this test already sent (any time: the test spans minutes, not the cooldown).
        when(notificationRepo.existsByUserIdAndCategoryAndTitleAndCreatedAtAfter(anyLong(), eq(Category.CAMERA), anyString(), any()))
                .thenAnswer(i -> sent.stream().anyMatch(s -> s.startsWith(i.getArgument(2, String.class) + " |")));
        service = new CameraAlertService(mock(SmartDeviceRepository.class), mock(CameraStatusRepository.class),
                mock(CameraBatteryReadingRepository.class), notificationRepo, notifications, users,
                mock(WeatherService.class), presence, 0, 0, clock);
    }

    @Test
    @DisplayName("a person inside while everyone's away is reported after a 3-minute check")
    void personInside() {
        when(presence.everyoneAway()).thenReturn(true);
        service.personDetected(living, wired);
        service.confirmIndoorPersons();
        assertTrue(sent.isEmpty(), "waits before alerting");

        clock.plus(Duration.ofMinutes(3));
        service.confirmIndoorPersons();
        assertEquals(1, sent.size());
        assertTrue(sent.get(0).startsWith("Person inside — Living Room | The Living Room camera saw someone at 1:00 AM"), sent.get(0));
        verify(notifications).send(eq(10L), eq(AlertType.INDOOR_PERSON), eq(Severity.CRITICAL), anyString(), anyString());

        // Another sighting inside the cooldown doesn't repeat it.
        service.personDetected(living, wired);
        clock.plus(Duration.ofMinutes(3));
        service.confirmIndoorPersons();
        assertEquals(1, sent.size());
    }

    @Test
    @DisplayName("no alert when someone's phone comes back during the check, or while anyone is home")
    void someoneCameHome() {
        when(presence.everyoneAway()).thenReturn(true, false);
        service.personDetected(living, wired);
        clock.plus(Duration.ofMinutes(3));
        service.confirmIndoorPersons();
        assertTrue(sent.isEmpty());

        when(presence.everyoneAway()).thenReturn(false);
        service.personDetected(living, wired);
        clock.plus(Duration.ofMinutes(3));
        service.confirmIndoorPersons();
        assertTrue(sent.isEmpty());
    }

    @Test
    @DisplayName("sustained sound while away: three or more pushes over 2+ minutes, none more than 2 apart")
    void sustainedNoise() {
        when(presence.everyoneAway()).thenReturn(true);
        service.detectionEvent(living, wired, "sound");
        clock.plus(Duration.ofSeconds(70));
        service.detectionEvent(living, wired, "sound");
        clock.plus(Duration.ofSeconds(40));
        service.detectionEvent(living, wired, "person"); // not sound
        assertTrue(sent.isEmpty());
        clock.plus(Duration.ofSeconds(20));
        service.detectionEvent(living, wired, "crying");  // 2m10s since the first
        assertEquals(1, sent.size());
        assertTrue(sent.get(0).startsWith("Noise inside — Living Room | The Living Room camera has heard sound for about 2 minutes (since 1:00 AM)"),
                sent.get(0));
        verify(notifications).send(eq(10L), eq(AlertType.INDOOR_NOISE), eq(Severity.WARNING), anyString(), anyString());
    }

    @Test
    @DisplayName("short or broken-up noise, outdoor cameras and noise while someone's home don't alert")
    void noNoiseAlert() {
        when(presence.everyoneAway()).thenReturn(true);
        // A gap of more than 2 minutes starts over.
        service.detectionEvent(living, wired, "sound");
        clock.plus(Duration.ofMinutes(1));
        service.detectionEvent(living, wired, "sound");
        clock.plus(Duration.ofMinutes(3));
        service.detectionEvent(living, wired, "sound");
        clock.plus(Duration.ofMinutes(1));
        service.detectionEvent(living, wired, "sound");
        assertTrue(sent.isEmpty());

        // Outdoor cameras are never counted.
        SmartDevice front = SmartDevice.builder().id(1L).name("Front").kind(SmartDevice.Kind.CAMERA).enabled(true).build();
        for (int i = 0; i < 5; i++) {
            service.detectionEvent(front, outdoor, "sound");
            clock.plus(Duration.ofMinutes(1));
        }
        assertTrue(sent.isEmpty());

        // Someone home.
        when(presence.everyoneAway()).thenReturn(false);
        for (int i = 0; i < 5; i++) {
            service.detectionEvent(living, wired, "sound");
            clock.plus(Duration.ofMinutes(1));
        }
        assertTrue(sent.isEmpty());
    }

    @Test
    @DisplayName("an outdoor person is still the outdoor alert, whatever presence says")
    void outdoorUnchanged() {
        SmartDevice front = SmartDevice.builder().id(1L).name("Front").kind(SmartDevice.Kind.CAMERA).enabled(true).build();
        service.personDetected(front, outdoor);
        assertEquals(1, sent.size());
        assertTrue(sent.get(0).startsWith("Person detected — Front"));
        verify(presence, never()).everyoneAway();
    }
}
