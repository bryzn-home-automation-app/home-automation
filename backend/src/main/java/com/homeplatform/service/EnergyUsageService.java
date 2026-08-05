package com.homeplatform.service;

import com.homeplatform.model.EnergyUsage;
import com.homeplatform.repository.EnergyUsageRepository;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;

@Service
public class EnergyUsageService {

    private final EnergyUsageRepository repository;

    public EnergyUsageService(EnergyUsageRepository repository) {
        this.repository = repository;
    }

    public List<EnergyUsage> getAll() {
        return repository.findAll();
    }

    public List<EnergyUsage> getByMeterId(Long meterId) {
        return repository.findByMeterIdOrderByTimestampDesc(meterId);
    }

    public List<EnergyUsage> getByMeterAndDateRange(Long meterId, LocalDateTime start, LocalDateTime end) {
        return repository.findByMeterIdAndTimestampBetweenOrderByTimestampAsc(meterId, start, end);
    }

    public List<EnergyUsage> getRecent(Long meterId, LocalDateTime since) {
        return repository.findRecentByMeterId(meterId, since);
    }

    public EnergyUsage save(EnergyUsage usage) {
        return repository.save(usage);
    }

    public List<EnergyUsage> saveAll(List<EnergyUsage> usages) {
        return repository.saveAll(usages);
    }

    public Double getTotalUsageSince(Long meterId, LocalDateTime since) {
        return repository.sumUsageSince(meterId, since);
    }
}
