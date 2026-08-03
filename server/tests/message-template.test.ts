import { describe, expect, it } from "vitest";
import { normalizedTemplateType, renderMessageTemplate } from "../src/modules/notifications/notification-delivery.service.js";

describe("message template rendering", () => {
  it("replaces supported variables and preserves unknown variables", () => {
    expect(renderMessageTemplate("Hello {{ customer }}, visit {{business}} at {{date_time}}. {{unknown}}", {
      customer: "Mekdes",
      business: "Addis Dental",
      date_time: "July 4 at 9:00 AM"
    })).toBe("Hello Mekdes, visit Addis Dental at July 4 at 9:00 AM. {{unknown}}");
  });

  it("normalizes notification job types to saved template types", () => {
    expect(normalizedTemplateType("manual_reminder")).toBe("reminder");
    expect(normalizedTemplateType("reminder_60m")).toBe("reminder");
    expect(normalizedTemplateType("appointment_confirmation")).toBe("confirmation");
    expect(normalizedTemplateType("appointment_rescheduled")).toBe("reschedule");
    expect(normalizedTemplateType("appointment_cancelled")).toBe("cancellation");
  });

  it("supports common variable aliases used in custom messages", () => {
    expect(renderMessageTemplate("Hi {{customer_name}}, {{staff}} will see you at {{location}} on {{date}}.", {
      customer_name: "Mekdes",
      staff: "Dr. Hana",
      location: "Main branch",
      date: "July 4 at 9:00 AM"
    })).toBe("Hi Mekdes, Dr. Hana will see you at Main branch on July 4 at 9:00 AM.");
  });
});
