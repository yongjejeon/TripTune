import React, { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Calendar, DateData } from "react-native-calendars";

export type DateISO = string; // "YYYY-MM-DD"

type Props = {
  initialStart?: DateISO;
  initialEnd?: DateISO;
  minDate?: DateISO;
  maxDate?: DateISO;
  maxTripDays?: number; // Maximum number of days for the trip (default 5)
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
  maxTripDays = 5, // Default to 5 days maximum
  onConfirm,
  onCancel,
}: Props) {
  const [startDate, setStartDate] = useState<DateISO | undefined>(initialStart);
  const [endDate, setEndDate] = useState<DateISO | undefined>(initialEnd);

  const valid = !!startDate && !!endDate && startDate <= endDate;
  const lastRangeKey = useRef<string | null>(null);

  // Calculate dynamic maxDate based on startDate + maxTripDays
  const dynamicMaxDate = useMemo(() => {
    if (!startDate) return maxDate;
    const start = parseISOToLocalDate(startDate);
    const maxEnd = new Date(start);
    maxEnd.setDate(start.getDate() + maxTripDays - 1); // -1 because start day counts as day 1
    const calculatedMax = ymd(maxEnd);
    // Return the earlier of calculated max or prop maxDate
    if (maxDate && maxDate < calculatedMax) return maxDate;
    return calculatedMax;
  }, [startDate, maxDate, maxTripDays]);

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
    
    // If user taps the same start date again, cancel the selection
    if (date === startDate) {
      setStartDate(undefined);
      setEndDate(undefined);
      return;
    }
    
    // Second tap
    if (date < startDate) {
      // If user selects earlier date, make it the new start
      setStartDate(date);
      setEndDate(undefined);
    } else {
      // Check if selected end date is within maxTripDays limit
      const start = parseISOToLocalDate(startDate);
      const end = parseISOToLocalDate(date);
      const daysDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end
      
      if (daysDiff > maxTripDays) {
        // If exceeds limit, set end date to maxTripDays from start
        const maxEnd = new Date(start);
        maxEnd.setDate(start.getDate() + maxTripDays - 1);
        setEndDate(ymd(maxEnd));
      } else {
        setEndDate(date);
      }
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
      <View className="mb-4 h-12 justify-center">
        <Text className="text-gray-500 text-center">
          {startDate && !endDate 
            ? `Select an end date (max ${maxTripDays} days) or tap start date again to cancel` 
            : "Tap a start day, then an end day"}
        </Text>
      </View>

      <Calendar
        onDayPress={handleDayPress}
        markedDates={markedWithToday}
        markingType="period"
        minDate={minDate}
        maxDate={startDate ? dynamicMaxDate : maxDate}
        enableSwipeMonths
        firstDay={1}
        theme={{
          todayTextColor: "#0061ff",
          arrowColor: "#0061ff",
          textDisabledColor: "#d9e1e8",
        }}
      />
    </View>
  );
}
