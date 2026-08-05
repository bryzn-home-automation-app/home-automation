package com.homeplatform.service;

import com.homeplatform.dto.UsageRangeSummaryResponse;
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

        public UsageRangeSummaryResponse getSummary(Long meterId, LocalDateTime start, LocalDateTime end) {
        double totalKwh = repository.sumUsageBetween(meterId, start, end);
        double averageKwh = repository.avgUsageBetween(meterId, start, end);
        long readingCount = repository.countByMeterIdAndTimestampBetween(meterId, start, end);

        UsageRangeSummaryResponse.UsagePoint highest = repository
            .findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhDescTimestampAsc(meterId, start, end)
            .map(usage -> new UsageRangeSummaryResponse.UsagePoint(
                usage.getTimestamp(),
                usage.getUsageKwh().doubleValue()
            ))
            .orElse(null);

        UsageRangeSummaryResponse.UsagePoint lowest = repository
            .findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhAscTimestampAsc(meterId, start, end)
            .map(usage -> new UsageRangeSummaryResponse.UsagePoint(
                usage.getTimestamp(),
                usage.getUsageKwh().doubleValue()
            ))
            .orElse(null);

        return new UsageRangeSummaryResponse(
            meterId,
            start,
            end,
            totalKwh,
            averageKwh,
            readingCount,
            highest,
            lowest
        );
        }
}
