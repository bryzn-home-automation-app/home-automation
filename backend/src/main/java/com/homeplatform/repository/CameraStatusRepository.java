package com.homeplatform.repository;

import com.homeplatform.model.CameraStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface CameraStatusRepository extends JpaRepository<CameraStatus, Long> {

    Optional<CameraStatus> findByDeviceId(Long deviceId);
}
