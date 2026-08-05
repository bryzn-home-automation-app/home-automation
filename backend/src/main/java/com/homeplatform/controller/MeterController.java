package com.homeplatform.controller;

import com.homeplatform.model.Meter;
import com.homeplatform.repository.MeterRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/meters")
public class MeterController {

    private final MeterRepository repository;

    public MeterController(MeterRepository repository) {
        this.repository = repository;
    }

    @GetMapping
    public ResponseEntity<List<Meter>> getAll() {
        return ResponseEntity.ok(repository.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Meter> getById(@PathVariable Long id) {
        return repository.findById(id)
                .map(ResponseEntity::ok)
                .orElse(ResponseEntity.notFound().build());
    }
}
