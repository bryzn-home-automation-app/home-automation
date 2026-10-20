package com.homeplatform.homeassistant;

import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.SmartDeviceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Upserts HA entities into {@code smart_devices}. Nothing here hard-codes an entity ID:
 * every {@code climate.*} entity is a thermostat and every {@code camera.*} a camera.
 * New devices start enabled; existing rows keep their {@code enabled} flag and public ID.
 */
@Service
public class DeviceDiscoveryService {

    private final SmartDeviceRepository repo;

    public DeviceDiscoveryService(SmartDeviceRepository repo) {
        this.repo = repo;
    }

    public record Result(int thermostats, int cameras, int added) {}

    /** Map an HA domain to a device kind, or empty for domains we don't manage. */
    public static Optional<SmartDevice.Kind> kindFor(HaEntityState s) {
        return switch (s.domain()) {
            case "climate" -> Optional.of(SmartDevice.Kind.THERMOSTAT);
            case "camera" -> Optional.of(SmartDevice.Kind.CAMERA);
            default -> Optional.empty();
        };
    }

    @Transactional
    public Result upsertAll(List<HaEntityState> states) {
        int thermostats = 0, cameras = 0, added = 0;
        for (HaEntityState s : states) {
            Optional<SmartDevice.Kind> kind = kindFor(s);
            if (kind.isEmpty()) continue;
            if (upsert(s, kind.get())) added++;
            if (kind.get() == SmartDevice.Kind.THERMOSTAT) thermostats++;
            else cameras++;
        }
        return new Result(thermostats, cameras, added);
    }

    /** Returns true when a new row was created. */
    boolean upsert(HaEntityState s, SmartDevice.Kind kind) {
        LocalDateTime now = LocalDateTime.now(ZoneOffset.UTC);
        Optional<SmartDevice> existing = repo.findByProviderEntityId(s.entityId());
        SmartDevice d = existing.orElseGet(() -> SmartDevice.builder()
                .publicId(UUID.randomUUID())
                .provider(SmartDevice.PROVIDER_HOME_ASSISTANT)
                .providerEntityId(s.entityId())
                .kind(kind)
                .enabled(true)
                .createdAt(now)
                .build());
        d.setName(s.friendlyName());
        d.setLastSeenAt(now);
        d.setUpdatedAt(now);
        repo.save(d);
        return existing.isEmpty();
    }
}
