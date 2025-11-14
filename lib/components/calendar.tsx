import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Calendar, DateData } from "react-native-calendars";

export type DateISO = string; // "YYYY-MM-DD"

type Props = {
  initialStart?: DateISO;
  initialEnd?: DateISO;
  minDate?: DateISO;
  maxDate?: DateISO;
  onConfirm: (range: { startDate: DateISO; endDate: DateISO; days: DateISO[] }) => void;
  onCancel?: () => void;
};

// ---- TZ-safe helpers (no toISOString) ----
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date): DateISO =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function parseISOToLocalDate(iso: DateISO): Date {
  // iso = "YYYY-MM-DD"
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1); // local-time date, midnight
}

function buildDaysLocal(startISO: DateISO, endISO: DateISO): DateISO[] {
  const s = parseISOToLocalDate(startISO);
  const e = parseISOToLocalDate(endISO);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return [];
  const out: DateISO[] = [];
  const cur = new Date(s);
  while (cur <= e) {
    out.push(ymd(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export default function CalendarRangePicker({
  initialStart,
  initialEnd,
  minDate,
  maxDate,
  onConfirm,
  onCancel,
}: Props) {
  const [startDate, setStartDate] = useState<DateISO | undefined>(initialStart);
  const [endDate, setEndDate] = useState<DateISO | undefined>(initialEnd);

  const valid = !!startDate && !!endDate && startDate <= endDate;
  const lastRangeKey = useRef<string | null>(null);

  const markedDates = useMemo(() => {
    if (!startDate) return {};
    const marked: Record<string, any> = {};
    if (!endDate || endDate < startDate) {
      marked[startDate] = { startingDay: true, endingDay: true, color: "#0061ff", textColor: "white" };
      return marked;
    }
    const days = buildDaysLocal(startDate, endDate); // local-safe
    days.forEach((d, i) => {
      if (i === 0) {
        marked[d] = { startingDay: true, color: "#0061ff", textColor: "white" };
      } else if (i === days.length - 1) {
        marked[d] = { endingDay: true, color: "#0061ff", textColor: "white" };
      } else {
        marked[d] = { color: "#cfe3ff", textColor: "#0b3a84" };
      }
    });
    return marked;
  }, [startDate, endDate]);

  const todayKey = ymd(new Date());
  const markedWithToday = useMemo(() => {
    const base = { ...markedDates };
    if (!base[todayKey]) {
      base[todayKey] = { textColor: "#0061ff" };
    }
    return base;
  }, [markedDates, todayKey]);

  const handleDayPress = (day: DateData) => {
    const date = day.dateString; // already "YYYY-MM-DD" in local
    // First tap or reset after complete range
    if (!startDate || (startDate && endDate)) {
      setStartDate(date);
      setEndDate(undefined);
      return;
    }
    // Second tap
    if (date < startDate) {
      setStartDate(date);
      setEndDate(undefined);
    } else {
      setEndDate(date);
    }
  };

  const days = valid ? buildDaysLocal(startDate!, endDate!) : [];

  useEffect(() => {
    if (!valid) return;
    const key = `${startDate}|${endDate}`;
    if (lastRangeKey.current === key) return;
    lastRangeKey.current = key;
    onConfirm({ startDate: startDate!, endDate: endDate!, days });
  }, [valid, startDate, endDate, days, onConfirm]);

  return (
    <View>
      <Text className="text-2xl font-rubik-bold mt-2 mb-2 text-center">Select Trip Dates</Text>
      <Text className="text-gray-500 mb-4 text-center">Tap a start day, then an end day.</Text>

      <Calendar
        onDayPress={handleDayPress}
        markedDates={markedWithToday}
        markingType="period"
        minDate={minDate}
        maxDate={maxDate}
        enableSwipeMonths
        firstDay={1}
        theme={{
          todayTextColor: "#0061ff",
          arrowColor: "#0061ff",
        }}
      />
    </View>
  );
}
