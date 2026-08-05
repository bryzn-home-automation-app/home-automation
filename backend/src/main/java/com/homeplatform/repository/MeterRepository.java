package com.homeplatform.repository;

import com.homeplatform.model.Meter;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface MeterRepository extends JpaRepository<Meter, Long> {

    List<Meter> findByAccountId(Long accountId);

    Optional<Meter> findByMeterNumber(String meterNumber);
}
