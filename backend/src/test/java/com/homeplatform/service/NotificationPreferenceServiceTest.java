package com.homeplatform.service;

import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification;
import com.homeplatform.model.NotificationPreference;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.push.NotificationCreatedEvent;
import com.homeplatform.repository.NotificationPreferenceRepository;
import com.homeplatform.repository.NotificationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Alert-type settings: defaults, saving, and what send() does with them. */
class NotificationPreferenceServiceTest {

    private final List<NotificationPreference> rows = new ArrayList<>();
    private NotificationPreferenceRepository repo;
    private NotificationPreferenceService prefs;

    @BeforeEach
    void setUp() {
        repo = mock(NotificationPreferenceRepository.class);
        when(repo.findByUserId(any())).thenAnswer(i -> rows.stream().filter(r -> r.getUserId().equals(i.getArgument(0))).toList());
        when(repo.findByUserIdAndAlertType(any(), any())).thenAnswer(i -> rows.stream()
                .filter(r -> r.getUserId().equals(i.getArgument(0)) && r.getAlertType() == i.getArgument(1)).findFirst());
        when(repo.findByAlertTypeAndInAppFalse(any())).thenAnswer(i -> rows.stream()
                .filter(r -> r.getAlertType() == i.getArgument(0) && !r.isInApp()).toList());
        when(repo.save(any())).thenAnswer(i -> {
            NotificationPreference p = i.getArgument(0);
            if (!rows.contains(p)) rows.add(p);
            return p;
        });
        doAnswer(i -> {
            rows.removeAll((List<?>) i.getArgument(0));
            return null;
        }).when(repo).deleteAll(any());
        prefs = new NotificationPreferenceService(repo);
    }

    @Test
    @DisplayName("every type is listed with its defaults until changed: camera alerts and Roomba errors on the phone")
    void defaults() {
        var list = prefs.list(1L);
        assertEquals(AlertType.values().length, list.size());
        var person = list.stream().filter(r -> r.type().equals("PERSON_DETECTED")).findFirst().orElseThrow();
        assertTrue(person.inApp() && person.push());
        assertEquals("CAMERA", person.category());
        var daily = list.stream().filter(r -> r.type().equals("ENERGY_DAILY")).findFirst().orElseThrow();
        assertTrue(daily.inApp());
        assertFalse(daily.push());
        assertTrue(prefs.effective(1L, AlertType.ROOMBA_ERROR).push());
    }

    @Test
    @DisplayName("a member's change sticks, phone needs the alert itself, and reset brings the defaults back")
    void update() {
        var r = prefs.update(1L, AlertType.ENERGY_DAILY, true, true);
        assertTrue(r.push());
        assertEquals(new NotificationPreferenceService.Effective(true, true), prefs.effective(1L, AlertType.ENERGY_DAILY));

        r = prefs.update(1L, AlertType.PERSON_DETECTED, false, true);
        assertFalse(r.inApp());
        assertFalse(r.push(), "no phone alert for a type that's off");
        assertEquals(1, rows.stream().filter(p -> p.getAlertType() == AlertType.PERSON_DETECTED).count());
        assertTrue(prefs.effective(2L, AlertType.PERSON_DETECTED).inApp(), "someone else's choice doesn't apply");

        assertEquals(List.of(2L, 3L), prefs.wanting(List.of(1L, 2L, 3L), AlertType.PERSON_DETECTED));
        assertEquals(List.of(1L, 2L), prefs.wanting(List.of(1L, 2L), AlertType.CAMERA_OFFLINE));

        prefs.reset(1L);
        assertTrue(prefs.effective(1L, AlertType.PERSON_DETECTED).inApp());
        assertFalse(prefs.effective(1L, AlertType.ENERGY_DAILY).push());
    }

    @Test
    @DisplayName("send(): skipped when turned off; otherwise saved, with the phone choice on the event")
    void send() {
        NotificationRepository notifications = mock(NotificationRepository.class);
        when(notifications.save(any())).thenAnswer(i -> i.getArgument(0));
        ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
        NotificationService service = new NotificationService(notifications, events, prefs);

        prefs.update(1L, AlertType.CAMERA_OFFLINE, false, false);
        assertNull(service.send(1L, AlertType.CAMERA_OFFLINE, Severity.WARNING, "Front camera offline", "x"));
        verifyNoInteractions(notifications, events);

        prefs.update(1L, AlertType.PERSON_DETECTED, true, false);
        Notification n = service.send(1L, AlertType.PERSON_DETECTED, Severity.INFO, "Person detected — Front", "x");
        assertEquals(Notification.Category.CAMERA, n.getCategory());
        var event = ArgumentCaptor.forClass(NotificationCreatedEvent.class);
        verify(events).publishEvent(event.capture());
        assertEquals(Boolean.FALSE, event.getValue().push(), "in the list, but not on the phone");
    }
}
