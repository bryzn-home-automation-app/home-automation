package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.SmartDeviceRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class DeviceDiscoveryServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    @DisplayName("upserts climate/camera entities only, keeping existing IDs and enabled flag")
    void upserts() throws Exception {
        SmartDeviceRepository repo = mock(SmartDeviceRepository.class);
        UUID existingId = UUID.randomUUID();
        SmartDevice existing = SmartDevice.builder().id(1L).publicId(existingId)
                .providerEntityId("climate.main").kind(SmartDevice.Kind.THERMOSTAT).enabled(false).build();
        when(repo.findByProviderEntityId("climate.main")).thenReturn(Optional.of(existing));
        when(repo.findByProviderEntityId("camera.front_door")).thenReturn(Optional.empty());

        var states = List.of(
                HaEntityState.fromJson(JSON.readTree("{\"entity_id\":\"climate.main\",\"state\":\"heat\",\"attributes\":{\"friendly_name\":\"Main Floor\"}}")),
                HaEntityState.fromJson(JSON.readTree("{\"entity_id\":\"camera.front_door\",\"state\":\"idle\",\"attributes\":{}}")),
                HaEntityState.fromJson(JSON.readTree("{\"entity_id\":\"sensor.outside\",\"state\":\"70\",\"attributes\":{}}")));

        var result = new DeviceDiscoveryService(repo).upsertAll(states);

        assertEquals(new DeviceDiscoveryService.Result(1, 1, 1), result);
        assertEquals(existingId, existing.getPublicId(), "public id is stable");
        assertFalse(existing.isEnabled(), "admin-disabled stays disabled");
        assertEquals("Main Floor", existing.getName());
        var saved = ArgumentCaptor.forClass(SmartDevice.class);
        verify(repo, times(2)).save(saved.capture());
        SmartDevice cam = saved.getAllValues().get(1);
        assertEquals(SmartDevice.Kind.CAMERA, cam.getKind());
        assertTrue(cam.isEnabled());
        assertNotNull(cam.getPublicId());
        assertEquals("camera.front_door", cam.getName(), "falls back to entity id without friendly_name");
    }
}
