package com.homeplatform.homeassistant;

import com.homeplatform.dto.CameraRecordingResponse;
import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Recordings stored on the cameras' HomeBase, behind {@code /api/home/cameras/recordings}.
 * Only recordings of enabled, linked cameras are listed or served; the camera's serial
 * (its go2rtc stream name) is how a recording maps to one, and never leaves this layer.
 */
@Service
public class CameraRecordingService {

    static final int DEFAULT_DAYS = 7;
    static final int MAX_DAYS = 60;

    private final RecordingsClient client;
    private final SmartDeviceRepository deviceRepo;
    private final CameraStatusRepository statusRepo;

    public CameraRecordingService(RecordingsClient client, SmartDeviceRepository deviceRepo, CameraStatusRepository statusRepo) {
        this.client = client;
        this.deviceRepo = deviceRepo;
        this.statusRepo = statusRepo;
    }

    /** Newest first. {@code days} counts back from today (default 7, at most 60). */
    public List<CameraRecordingResponse> list(Integer days) {
        int n = days == null ? DEFAULT_DAYS : days;
        if (n < 1 || n > MAX_DAYS) throw new IllegalArgumentException("'days' must be 1–" + MAX_DAYS);
        Map<String, SmartDevice> cameras = camerasBySerial();
        return client.list(n).stream()
                .filter(r -> cameras.containsKey(r.sn()))
                .map(r -> {
                    SmartDevice d = cameras.get(r.sn());
                    return new CameraRecordingResponse(r.id(), d.getPublicId().toString(), d.getName(),
                            r.start(), r.end(), r.durationMs(), r.bytes(), r.hasThumb());
                })
                .toList();
    }

    public byte[] video(String id) {
        return client.video(allowed(id).id());
    }

    public byte[] thumbnail(String id) {
        RecordingsClient.Recording r = allowed(id);
        if (!r.hasThumb()) throw new HomeDeviceService.NotFound();
        return client.thumbnail(r.id());
    }

    /** The recording, if it exists and belongs to a camera the app shows. */
    private RecordingsClient.Recording allowed(String id) {
        if (id == null || !id.matches("\\d{1,20}")) throw new HomeDeviceService.NotFound();
        RecordingsClient.Recording r;
        try {
            r = client.recording(id);
        } catch (RecordingsClient.Missing e) {
            throw new HomeDeviceService.NotFound();
        }
        if (!camerasBySerial().containsKey(r.sn())) throw new HomeDeviceService.NotFound();
        return r;
    }

    private Map<String, SmartDevice> camerasBySerial() {
        Map<String, SmartDevice> out = new HashMap<>();
        for (SmartDevice d : deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA)) {
            statusRepo.findByDeviceId(d.getId())
                    .map(CameraStatus::getStreamName)
                    .flatMap(Optional::ofNullable)
                    .ifPresent(sn -> out.put(sn, d));
        }
        return out;
    }
}
