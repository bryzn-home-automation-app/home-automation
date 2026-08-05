package com.homeplatform.service;

import com.homeplatform.model.UtilityBill;
import com.homeplatform.repository.UtilityBillRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class UtilityBillService {

    private final UtilityBillRepository repository;

    public UtilityBillService(UtilityBillRepository repository) {
        this.repository = repository;
    }

    public List<UtilityBill> getAll() {
        return repository.findAll();
    }

    public List<UtilityBill> getByAccountId(Long accountId) {
        return repository.findByAccountIdOrderByBillingPeriodStartDesc(accountId);
    }

    public List<UtilityBill> getByStatus(String status) {
        return repository.findByStatus(status);
    }

    public UtilityBill save(UtilityBill bill) {
        return repository.save(bill);
    }

    public List<UtilityBill> saveAll(List<UtilityBill> bills) {
        return repository.saveAll(bills);
    }
}
