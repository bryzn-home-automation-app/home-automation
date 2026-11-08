package com.homeplatform.model;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** The gas charge lines are stored as JSON text and must reach the client as an array, not a string. */
class CoservBillJsonTest {

    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();

    private CoservBill bill(String gasLineItems) {
        return CoservBill.builder()
                .billingPeriodStart(LocalDate.of(2026, 9, 8))
                .billingPeriodEnd(LocalDate.of(2026, 10, 7))
                .gasCharge(new BigDecimal("41.27"))
                .gasLineItems(gasLineItems)
                .totalDue(new BigDecimal("249.00"))
                .ingestionBatchId(UUID.randomUUID())
                .build();
    }

    @Test
    void sendsGasLineItemsAsAnArray() throws Exception {
        JsonNode out = JSON.readTree(JSON.writeValueAsString(bill(
                "[{\"label\":\"Customer Charge\",\"amount\":18,\"kind\":\"fixed\"}]")));
        assertTrue(out.get("gasLineItems").isArray());
        assertEquals("fixed", out.get("gasLineItems").get(0).get("kind").asText());
    }

    @Test
    void sendsNullWhenTheBillHasNoLineItems() throws Exception {
        JsonNode out = JSON.readTree(JSON.writeValueAsString(bill(null)));
        assertTrue(out.get("gasLineItems").isNull());
    }
}
