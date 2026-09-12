package com.homeplatform.repository;

import com.homeplatform.model.CoservBill;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface CoservBillRepository extends JpaRepository<CoservBill, Long> {

    List<CoservBill> findByAccountIdOrderByBillingPeriodStartDesc(Long accountId);

    List<CoservBill> findAllByOrderByBillingPeriodStartDesc();
}
