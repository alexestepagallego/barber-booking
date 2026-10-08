import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

import { formatDuration, formatLongDate, formatPrice, formatTime } from "@/lib/format";

/**
 * Transactional emails, written with React Email so they render reliably in
 * mail clients (tables and inline styles under the hood). Every email also
 * has a plain-text version, which must make sense without any styling.
 * React escapes all interpolated values, so customer-provided text cannot
 * inject markup.
 */

export type EmailAppointment = {
  serviceName: string;
  barberName: string;
  customerName: string;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  priceCents: number;
};

export type EmailShop = {
  name: string;
  phone: string | null;
  address: string | null;
  timezone: string;
};

type Kind = "confirmed" | "rescheduled" | "cancelled" | "reminder";

export type EmailProps = {
  kind: Kind;
  appointment: EmailAppointment;
  shop: EmailShop;
  /** Manage link for active appointments; booking page for cancelled ones. */
  actionUrl: string;
  /** Rescheduled emails show where the appointment came from. */
  previousStartsAt?: Date;
  cancellationCutoffMinutes: number;
  /** Whether the customer can still change or cancel online when the email is sent. */
  canModify: boolean;
  /** "today"/"tomorrow" relative to the send time, for reminder wording. */
  relativeDay?: "today" | "tomorrow";
};

function copyFor({ kind, shop, relativeDay, canModify }: EmailProps) {
  const manage = canModify ? "Manage or cancel" : "View appointment";
  switch (kind) {
    case "confirmed":
      return {
        subject: `Your appointment at ${shop.name} is confirmed`,
        heading: "You're booked",
        intro: "thanks for booking with us. Here are the details of your appointment.",
        action: manage,
      };
    case "rescheduled":
      return {
        subject: `Your appointment at ${shop.name} has moved`,
        heading: "New time confirmed",
        intro: "your appointment has been moved. Here is the new time.",
        action: manage,
      };
    case "cancelled":
      return {
        subject: `Your appointment at ${shop.name} was cancelled`,
        heading: "Appointment cancelled",
        intro:
          "this appointment has been cancelled and the time released. We hope to see you soon.",
        action: "Book another time",
      };
    case "reminder":
      return {
        subject: relativeDay
          ? `See you ${relativeDay} at ${shop.name}`
          : `Reminder: your appointment at ${shop.name}`,
        heading: relativeDay ? `See you ${relativeDay}` : "See you soon",
        intro: "a quick reminder of your appointment.",
        action: canModify ? "Can't make it? Manage or cancel" : "View appointment",
      };
  }
}

const styles = {
  body: { backgroundColor: "#f4f4f4", fontFamily: "Helvetica, Arial, sans-serif", margin: 0 },
  container: { backgroundColor: "#ffffff", margin: "32px auto", maxWidth: "520px" },
  header: { backgroundColor: "#050505", padding: "28px 32px", textAlign: "center" as const },
  brand: {
    color: "#ffffff",
    fontFamily: "Georgia, 'Times New Roman', serif",
    fontSize: "26px",
    fontStyle: "italic",
    margin: 0,
  },
  content: { padding: "32px" },
  heading: { color: "#050505", fontFamily: "Georgia, serif", fontSize: "24px", margin: "0 0 12px" },
  text: { color: "#333333", fontSize: "15px", lineHeight: "24px", margin: "0 0 16px" },
  label: {
    color: "#888888",
    fontSize: "11px",
    letterSpacing: "2px",
    margin: "16px 0 2px",
    textTransform: "uppercase" as const,
  },
  value: { color: "#050505", fontSize: "16px", margin: 0 },
  struck: { color: "#888888", fontSize: "14px", margin: "0", textDecoration: "line-through" },
  button: {
    backgroundColor: "#050505",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "13px",
    letterSpacing: "2px",
    padding: "14px 24px",
    textDecoration: "none",
    textTransform: "uppercase" as const,
  },
  footer: { color: "#888888", fontSize: "12px", lineHeight: "18px", margin: 0 },
};

function when(date: Date, timezone: string) {
  return `${formatLongDate(date, timezone)}, ${formatTime(date, timezone)}`;
}

export function AppointmentEmail(props: EmailProps) {
  const { kind, appointment: a, shop, actionUrl, previousStartsAt, canModify } = props;
  const copy = copyFor(props);
  const firstName = a.customerName.split(" ")[0];
  const cutoff = formatDuration(props.cancellationCutoffMinutes);
  const range = `${when(a.startsAt, shop.timezone)}–${formatTime(a.endsAt, shop.timezone)}`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{`${copy.heading}: ${a.serviceName}, ${when(a.startsAt, shop.timezone)}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.brand}>{shop.name}</Text>
          </Section>
          <Section style={styles.content}>
            <Heading as="h1" style={styles.heading}>
              {copy.heading}
            </Heading>
            <Text style={styles.text}>
              Hi {firstName}, {copy.intro}
            </Text>

            <Text style={styles.label}>Service</Text>
            <Text style={styles.value}>
              {a.serviceName} · {formatDuration(a.durationMinutes)} · {formatPrice(a.priceCents)}
            </Text>
            <Text style={styles.label}>When</Text>
            {previousStartsAt ? (
              <>
                {/* Words, not only strike-through: plain-text clients and screen readers. */}
                <Text style={styles.struck}>Was: {when(previousStartsAt, shop.timezone)}</Text>
                <Text style={styles.value}>Now: {range}</Text>
              </>
            ) : (
              <Text style={kind === "cancelled" ? styles.struck : styles.value}>
                {kind === "cancelled" ? `Cancelled: ${range}` : range}
              </Text>
            )}
            <Text style={styles.label}>Barber</Text>
            <Text style={styles.value}>{a.barberName}</Text>
            {shop.address && (
              <>
                <Text style={styles.label}>Where</Text>
                <Text style={styles.value}>{shop.address}</Text>
              </>
            )}

            <Section style={{ margin: "28px 0 8px" }}>
              <Button href={actionUrl} style={styles.button}>
                {copy.action}
              </Button>
            </Section>
            {kind !== "cancelled" && (
              <Text style={{ ...styles.footer, margin: "12px 0 0" }}>
                {canModify
                  ? `You can change or cancel online until ${cutoff} before the appointment.`
                  : `Online changes close ${cutoff} before the appointment${shop.phone ? `; to change it now, call ${shop.phone}` : ""}.`}{" "}
                The attached invite adds it to your calendar.
              </Text>
            )}
          </Section>
          <Hr style={{ borderColor: "#eeeeee", margin: 0 }} />
          <Section style={{ padding: "20px 32px" }}>
            <Text style={styles.footer}>
              {shop.name}
              {shop.phone ? ` · ${shop.phone}` : ""}
              {shop.address ? ` · ${shop.address}` : ""}
            </Text>
            <Text style={styles.footer}>
              You received this email because of an appointment booked at {shop.name}.
              {kind !== "cancelled" && " Keep it private: its link lets anyone manage the booking."}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderAppointmentEmail(props: EmailProps) {
  const element = <AppointmentEmail {...props} />;
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject: copyFor(props).subject, html, text };
}
