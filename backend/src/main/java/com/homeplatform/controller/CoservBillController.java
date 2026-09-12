package com.homeplatform.controller;

import com.homeplatform.model.CoservBill;
import com.homeplatform.service.CoservBillService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/coserv-bills")
public class CoservBillController {

    private final CoservBillService service;

    public CoservBillController(CoservBillService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<CoservBill>> getAll() {
        return ResponseEntity.ok(service.getAll());
    }

    @GetMapping("/account/{accountId}")
    public ResponseEntity<List<CoservBill>> getByAccount(@PathVariable Long accountId) {
        return ResponseEntity.ok(service.getByAccountId(accountId));
    }
}
