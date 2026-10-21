package com.homeplatform.homeassistant;

import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CameraRecordingServiceTest {

    private static final UUID FRONT = UUID.randomUUID();

    private RecordingsClient client;
    private CameraRecordingService service;

    private static RecordingsClient.Recording rec(String id, String sn, boolean thumb) {
        return new RecordingsClient.Recording(id, sn, "2026-10-20T19:47:51-05:00", "2026-10-20T19:48:11-05:00", 20_000L, 4_693_164L, thumb);
    }

    @BeforeEach
    void setUp() {
        client = mock(RecordingsClient.class);
        SmartDeviceRepository devices = mock(SmartDeviceRepository.class);
        CameraStatusRepository statuses = mock(CameraStatusRepository.class);
        SmartDevice front = new SmartDevice();
        front.setId(1L);
        front.setPublicId(FRONT);
        front.setName("Front");
        front.setKind(SmartDevice.Kind.CAMERA);
        front.setEnabled(true);
        SmartDevice indoor = new SmartDevice();
        indoor.setId(2L);
        indoor.setPublicId(UUID.randomUUID());
        indoor.setName("Living Room");
        indoor.setKind(SmartDevice.Kind.CAMERA);
        indoor.setEnabled(true);
        CameraStatus frontStatus = new CameraStatus();
        frontStatus.setStreamName("T8170FRONT");
        when(devices.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA)).thenReturn(List.of(front, indoor));
        when(statuses.findByDeviceId(1L)).thenReturn(Optional.of(frontStatus));
        when(statuses.findByDeviceId(2L)).thenReturn(Optional.empty()); // not linked: no serial
        service = new CameraRecordingService(client, devices, statuses);
    }

    @Test
    @DisplayName("lists recordings of linked cameras under their app ids and names; others are hidden")
    void list() {
        when(client.list(7)).thenReturn(List.of(rec("2", "T8170FRONT", true), rec("1", "T8170HIDDEN", true)));

        var out = service.list(null);

        assertEquals(1, out.size());
        assertEquals("2", out.get(0).id());
        assertEquals(FRONT.toString(), out.get(0).cameraId());
        assertEquals("Front", out.get(0).cameraName());
        assertEquals(20_000L, out.get(0).durationMs());
        assertThrows(IllegalArgumentException.class, () -> service.list(0));
        assertThrows(IllegalArgumentException.class, () -> service.list(61));
    }

    @Test
    @DisplayName("video and thumbnail only for a linked camera's recording; bad or unknown ids are 404s")
    void access() {
        when(client.recording("2")).thenReturn(rec("2", "T8170FRONT", false));
        when(client.recording("3")).thenReturn(rec("3", "T8170HIDDEN", true));
        when(client.recording("4")).thenThrow(new RecordingsClient.Missing());
        when(client.video("2")).thenReturn(new byte[]{9});

        assertArrayEquals(new byte[]{9}, service.video("2"));
        assertThrows(HomeDeviceService.NotFound.class, () -> service.thumbnail("2"), "no still");
        assertThrows(HomeDeviceService.NotFound.class, () -> service.video("3"), "camera not shown in the app");
        assertThrows(HomeDeviceService.NotFound.class, () -> service.video("4"));
        assertThrows(HomeDeviceService.NotFound.class, () -> service.video("../x"));
        verify(client, never()).video("3");
    }
}
