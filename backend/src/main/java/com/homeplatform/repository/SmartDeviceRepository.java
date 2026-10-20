package com.homeplatform.repository;

import com.homeplatform.model.SmartDevice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface SmartDeviceRepository extends JpaRepository<SmartDevice, Long> {

    Optional<SmartDevice> findByPublicId(UUID publicId);

    Optional<SmartDevice> findByProviderEntityId(String providerEntityId);

    List<SmartDevice> findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind kind);

    List<SmartDevice> findAllByOrderByKindAscNameAsc();
}
