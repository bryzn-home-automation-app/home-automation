package com.homeplatform.repository;

import com.homeplatform.model.WaterBill;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface WaterBillRepository extends JpaRepository<WaterBill, Long> {

    List<WaterBill> findByAccountIdOrderByBillingPeriodStartDesc(Long accountId);

    List<WaterBill> findAllByOrderByBillingPeriodStartDesc();
}
