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
 * mail clients (tables and inline styles under the hood). Every email has a
 * plain-text version as well.
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
};

const COPY: Record<
  Kind,
  { subject: (shop: string) => string; heading: string; intro: string; action: string }
> = {
  confirmed: {
    subject: (shop) => `Your appointment at ${shop} is confirmed`,
    heading: "You're booked",
    intro: "Thanks for booking with us. Here are the details of your appointment.",
    action: "Manage or cancel",
  },
  rescheduled: {
    subject: (shop) => `Your appointment at ${shop} has moved`,
    heading: "New time confirmed",
    intro: "Your appointment has been moved. This is the new time.",
    action: "Manage or cancel",
  },
  cancelled: {
    subject: (shop) => `Your appointment at ${shop} was cancelled`,
    heading: "Appointment cancelled",
    intro: "This appointment has been cancelled and the time released. We hope to see you soon.",
    action: "Book another time",
  },
  reminder: {
    subject: (shop) => `See you tomorrow at ${shop}`,
    heading: "See you tomorrow",
    intro: "A quick reminder of your appointment.",
    action: "Can't make it? Manage or cancel",
  },
};

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

export function AppointmentEmail({
  kind,
  appointment: a,
  shop,
  actionUrl,
  previousStartsAt,
  cancellationCutoffMinutes,
}: EmailProps) {
  const copy = COPY[kind];
  const firstName = a.customerName.split(" ")[0];
  const cutoffHours = Math.round(cancellationCutoffMinutes / 60);

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
              Hi {firstName}, {copy.intro.charAt(0).toLowerCase() + copy.intro.slice(1)}
            </Text>

            <Text style={styles.label}>Service</Text>
            <Text style={styles.value}>
              {a.serviceName} · {formatDuration(a.durationMinutes)} · {formatPrice(a.priceCents)}
            </Text>
            <Text style={styles.label}>When</Text>
            {previousStartsAt && (
              <Text style={styles.struck}>{when(previousStartsAt, shop.timezone)}</Text>
            )}
            <Text style={kind === "cancelled" ? styles.struck : styles.value}>
              {when(a.startsAt, shop.timezone)}–{formatTime(a.endsAt, shop.timezone)}
            </Text>
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
                You can change or cancel online until {cutoffHours} h before the appointment. The
                attached invite adds it to your calendar.
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
              You received this email because you booked an appointment. Keep it private: its link
              lets anyone manage the booking.
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
  return { subject: COPY[props.kind].subject(props.shop.name), html, text };
}
