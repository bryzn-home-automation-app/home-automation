package com.homeplatform.repository;

import com.homeplatform.model.RoombaDevice;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface RoombaDeviceRepository extends JpaRepository<RoombaDevice, Long> {
    Optional<RoombaDevice> findTopByOrderByUpdatedAtDesc();
}
