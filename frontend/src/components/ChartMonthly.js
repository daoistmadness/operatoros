import React, { memo, useMemo } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

function ChartMonthly({ data }) {
  const options = useMemo(() => ({
    responsive: true,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: false,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: {
          display: true,
          drawBorder: false,
          color: "rgba(0, 0, 0, 0.05)",
        },
      },
      x: {
        grid: {
          display: false,
        },
      },
    },
  }), []);

  const chartData = useMemo(() => ({
    labels: data.map((d) => {
      const date = new Date(d.month);
      return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    }),
    datasets: [
      {
        label: "Late Entries",
        data: data.map((d) => d.late_count),
        backgroundColor: "#6366f1",
        borderRadius: 8,
        hoverBackgroundColor: "#4f46e5",
      },
    ],
  }), [data]);

  return (
    <figure className="h-64">
      <figcaption className="sr-only">
        Monthly late entries bar chart showing late count per month.
      </figcaption>
      <div role="img" aria-label={`Monthly late entries chart: ${data.map(d => {
        const date = new Date(d.month);
        return `${date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })}: ${d.late_count} late`;
      }).join(", ")}`}>
        <Bar options={options} data={chartData} />
      </div>
    </figure>
  );
}

export default memo(ChartMonthly);
