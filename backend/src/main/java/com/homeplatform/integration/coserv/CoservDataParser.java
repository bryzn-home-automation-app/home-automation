package com.homeplatform.integration.coserv;

import com.homeplatform.model.EnergyUsage;
import com.homeplatform.model.Meter;
import com.homeplatform.model.UtilityAccount;
import com.homeplatform.model.UtilityBill;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.w3c.dom.*;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.xpath.*;
import java.io.InputStream;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Parses Green Button (NAESB ESPI) XML data from SmartHub exports.
 *
 * Green Button is the industry-standard format for utility usage data.
 * The XML is wrapped in a ZIP file downloaded from the SmartHub Green Button page.
 *
 * XML structure (Atom feed with ESPI extensions):
 *   /feed/entry/content/UsagePoint — service location metadata
 *   /feed/entry/content/LocalTimeParameters — timezone info
 *   /feed/entry/content/IntervalBlock — usage readings
 *   /feed/entry/content/ReadingType — unit of measure metadata
 */
@Service
public class CoservDataParser {

    private static final Logger log = LoggerFactory.getLogger(CoservDataParser.class);

    private static final String ESPI_NS = "http://naesb.org/espi";
    private static final String ATOM_NS = "http://www.w3.org/2005/Atom";

    /**
     * Parse a Green Button ZIP download into EnergyUsage records.
     * Handles both successful data (real readings) and empty data (no gas usage).
     *
     * @param zipStream the downloaded ZIP file input stream
     * @param meter the meter these readings belong to
     * @param batchId UUID for this ingestion batch
     * @param sourceLabel human-readable source label
     * @return list of EnergyUsage records (may be empty if no data)
     */
    public List<EnergyUsage> parseGreenButtonZip(InputStream zipStream, Meter meter,
                                                  UUID batchId, String sourceLabel) {
        List<EnergyUsage> results = new ArrayList<>();

        try (ZipInputStream zis = new ZipInputStream(zipStream)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.getName().endsWith(".xml")) {
                    log.info("Parsing Green Button XML: {}", entry.getName());
                    List<EnergyUsage> parsed = parseGreenButtonXml(zis, meter, batchId, sourceLabel);
                    results.addAll(parsed);
                    log.info("Parsed {} usage records from {}", parsed.size(), entry.getName());
                }
                zis.closeEntry();
            }
        } catch (Exception e) {
            log.error("Failed to parse Green Button ZIP: {}", e.getMessage(), e);
        }

        return results;
    }

    /**
     * Parse a single Green Button XML file into EnergyUsage records.
     */
    private List<EnergyUsage> parseGreenButtonXml(InputStream xmlStream, Meter meter,
                                                   UUID batchId, String sourceLabel) {
        List<EnergyUsage> results = new ArrayList<>();

        try {
            Document doc = DocumentBuilderFactory.newInstance()
                    .newDocumentBuilder().parse(xmlStream);

            XPath xpath = XPathFactory.newInstance().newXPath();

            // Extract timezone offset from LocalTimeParameters
            int tzOffsetSeconds = extractTzOffset(doc, xpath);

            // Find all IntervalBlock entries
            NodeList intervalBlocks = (NodeList) xpath.evaluate(
                    "//ns:IntervalBlock",
                    doc, XPathConstants.NODESET);

            // Also try with namespace prefix
            if (intervalBlocks.getLength() == 0) {
                // Try without namespace
                intervalBlocks = doc.getElementsByTagNameNS(ESPI_NS, "IntervalBlock");
            }
            if (intervalBlocks.getLength() == 0) {
                intervalBlocks = doc.getElementsByTagName("IntervalBlock");
            }

            for (int i = 0; i < intervalBlocks.getLength(); i++) {
                Element block = (Element) intervalBlocks.item(i);

                // Get interval metadata
                Element interval = getFirstChildElement(block, "interval");
                if (interval == null) interval = getFirstChildElementNS(block, ESPI_NS, "interval");

                Integer uom = getChildInt(interval, "uom");
                // uom 72 = kWh (energy), uom 38 = kW (demand)
                // We only want energy (kWh), skip demand (kW)
                // If no uom specified, default to including it
                boolean isDemand = (uom != null && uom == 38);

                // Get the ReadingType to double-check commodity
                // commodity 1 = electricity — we include both electric and gas

                // Extract each IntervalReading
                NodeList readings = block.getElementsByTagNameNS(ESPI_NS, "IntervalReading");
                if (readings.getLength() == 0) {
                    readings = block.getElementsByTagName("IntervalReading");
                }

                for (int j = 0; j < readings.getLength(); j++) {
                    Element reading = (Element) readings.item(j);

                    // Get timestamp
                    Element timePeriod = getFirstChildElement(reading, "timePeriod");
                    if (timePeriod == null) timePeriod = getFirstChildElementNS(reading, ESPI_NS, "timePeriod");

                    Long startEpoch = getChildLong(timePeriod, "start");
                    Long durationSeconds = getChildLong(timePeriod, "duration");

                    if (startEpoch == null) continue;

                    // Get value
                    Long rawValue = getChildLong(reading, "value");
                    Integer multiplier = getChildInt(reading, "powerOfTenMultiplier");

                    if (rawValue == null) continue;

                    // Calculate actual value: rawValue / 10^multiplier
                    int mult = (multiplier != null) ? multiplier : 0;
                    BigDecimal usageKwh = BigDecimal.valueOf(rawValue)
                            .divide(BigDecimal.TEN.pow(mult), 3, RoundingMode.HALF_UP);

                    // If demand data (kW), skip — we want kWh
                    if (isDemand) {
                        log.debug("Skipping demand reading: {} kW at epoch {}",
                                usageKwh, startEpoch);
                        continue;
                    }

                    // Skip zero readings for demand — but keep zero for energy (means no usage)
                    // For gas with no usage, this will create a 0 kWh record

                    // Convert epoch to LocalDateTime with timezone adjustment
                    LocalDateTime timestamp = Instant.ofEpochSecond(startEpoch)
                            .atZone(ZoneId.ofOffset("UTC", ZoneOffset.ofTotalSeconds(tzOffsetSeconds)))
                            .toLocalDateTime();

                    EnergyUsage usage = EnergyUsage.builder()
                            .meter(meter)
                            .timestamp(timestamp)
                            .usageKwh(usageKwh)
                            .cost(null)  // Green Button doesn't include cost
                            .source(sourceLabel)
                            .sourceProvider("coserv")
                            .ingestionBatchId(batchId)
                            .processingVersion("1.0")
                            .build();

                    if (isValidUsageRecord(usageKwh, timestamp)) {
                        results.add(usage);
                    }
                }
            }

        } catch (Exception e) {
            log.error("Failed to parse Green Button XML: {}", e.getMessage(), e);
        }

        return results;
    }

    /**
     * Extract timezone offset in seconds from LocalTimeParameters.
     */
    private int extractTzOffset(Document doc, XPath xpath) {
        try {
            NodeList ltps = doc.getElementsByTagNameNS(ESPI_NS, "LocalTimeParameters");
            if (ltps.getLength() == 0) ltps = doc.getElementsByTagName("LocalTimeParameters");
            if (ltps.getLength() > 0) {
                Element ltp = (Element) ltps.item(0);
                Integer offset = getChildInt(ltp, "tzOffset");
                return (offset != null) ? offset : -21600; // default CST
            }
        } catch (Exception e) {
            log.debug("Could not extract tzOffset, defaulting to CST: {}", e.getMessage());
        }
        return -21600; // default UTC-6 (Central)
    }

    // --- XML helpers ---

    private Element getFirstChildElement(Element parent, String tagName) {
        NodeList children = parent.getElementsByTagName(tagName);
        return children.getLength() > 0 ? (Element) children.item(0) : null;
    }

    private Element getFirstChildElementNS(Element parent, String ns, String tagName) {
        NodeList children = parent.getElementsByTagNameNS(ns, tagName);
        return children.getLength() > 0 ? (Element) children.item(0) : null;
    }

    private Long getChildLong(Element parent, String tagName) {
        Element child = getFirstChildElement(parent, tagName);
        if (child != null) {
            try {
                return Long.parseLong(child.getTextContent().trim());
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return null;
    }

    private Integer getChildInt(Element parent, String tagName) {
        Long val = getChildLong(parent, tagName);
        return val != null ? val.intValue() : null;
    }

    // --- Validation ---

    private boolean isValidUsageRecord(BigDecimal usageKwh, LocalDateTime timestamp) {
        if (usageKwh == null || usageKwh.compareTo(BigDecimal.ZERO) < 0) return false;
        if (timestamp == null || timestamp.isAfter(LocalDateTime.now().plusDays(1))) return false;
        return true;
    }
}
