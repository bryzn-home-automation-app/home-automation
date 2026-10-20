package com.homeplatform.repository;

import com.homeplatform.model.ThermostatStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface ThermostatStatusRepository extends JpaRepository<ThermostatStatus, Long> {

    Optional<ThermostatStatus> findByDeviceId(Long deviceId);
}
