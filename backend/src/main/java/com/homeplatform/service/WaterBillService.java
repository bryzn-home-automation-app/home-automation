package com.homeplatform.service;

import com.homeplatform.model.WaterBill;
import com.homeplatform.repository.WaterBillRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class WaterBillService {

    private final WaterBillRepository repository;

    public WaterBillService(WaterBillRepository repository) {
        this.repository = repository;
    }

    public List<WaterBill> getAll() {
        return repository.findAllByOrderByBillingPeriodStartDesc();
    }

    public List<WaterBill> getByAccountId(Long accountId) {
        return repository.findByAccountIdOrderByBillingPeriodStartDesc(accountId);
    }

    public WaterBill save(WaterBill bill) {
        return repository.save(bill);
    }
}
