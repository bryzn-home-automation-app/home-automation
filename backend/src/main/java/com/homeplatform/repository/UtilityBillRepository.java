package com.homeplatform.repository;

import com.homeplatform.model.UtilityBill;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface UtilityBillRepository extends JpaRepository<UtilityBill, Long> {

    List<UtilityBill> findByAccountIdOrderByBillingPeriodStartDesc(Long accountId);

    List<UtilityBill> findByStatus(String status);
}
