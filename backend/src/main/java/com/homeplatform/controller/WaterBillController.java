package com.homeplatform.controller;

import com.homeplatform.model.WaterBill;
import com.homeplatform.service.WaterBillService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/water-bills")
public class WaterBillController {

    private final WaterBillService service;

    public WaterBillController(WaterBillService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<WaterBill>> getAll() {
        return ResponseEntity.ok(service.getAll());
    }

    @GetMapping("/account/{accountId}")
    public ResponseEntity<List<WaterBill>> getByAccount(@PathVariable Long accountId) {
        return ResponseEntity.ok(service.getByAccountId(accountId));
    }
}
