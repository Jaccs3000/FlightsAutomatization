import { describe, expect, it } from "vitest";
import { buildEmailJsPayload } from "./emailjs";

describe("EmailJS payload", () => {
  const message = { recipient: "alerts@example.com", subject: "Flight alert", html: "<h1>Price found</h1>" };

  it("sends the configured template values using EmailJS's HTTPS API fields", () => {
    expect(buildEmailJsPayload({ serviceId: "service_test", templateId: "template_test", publicKey: "public_test", privateKey: "" }, message)).toEqual({
      service_id: "service_test",
      template_id: "template_test",
      user_id: "public_test",
      template_params: { to_email: "alerts@example.com", subject: "Flight alert", html_body: "<h1>Price found</h1>" },
    });
  });

  it("adds the optional private key only when configured", () => {
    expect(buildEmailJsPayload({ serviceId: "service_test", templateId: "template_test", publicKey: "public_test", privateKey: "private_test" }, message)).toMatchObject({ accessToken: "private_test" });
    expect(buildEmailJsPayload({ serviceId: "service_test", templateId: "template_test", publicKey: "public_test", privateKey: "" }, message)).not.toHaveProperty("accessToken");
  });
});
