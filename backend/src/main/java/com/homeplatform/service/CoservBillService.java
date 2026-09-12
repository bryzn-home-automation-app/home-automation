package com.homeplatform.service;

import com.homeplatform.model.CoservBill;
import com.homeplatform.repository.CoservBillRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CoservBillService {

    private final CoservBillRepository repository;

    public CoservBillService(CoservBillRepository repository) {
        this.repository = repository;
    }

    public List<CoservBill> getAll() {
        return repository.findAllByOrderByBillingPeriodStartDesc();
    }

    public List<CoservBill> getByAccountId(Long accountId) {
        return repository.findByAccountIdOrderByBillingPeriodStartDesc(accountId);
    }

    public CoservBill save(CoservBill bill) {
        return repository.save(bill);
    }
}
