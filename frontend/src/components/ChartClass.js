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

function ChartClass({ data }) {
  const options = useMemo(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => ` ${context.raw}% Punctuality`,
        },
      },
    },
    scales: {
      x: {
        min: 0,
        max: 100,
        grid: {
          display: true,
          color: "rgba(0, 0, 0, 0.05)",
        },
        ticks: {
          callback: (value) => `${value}%`,
        },
      },
      y: {
        grid: {
          display: false,
        },
      },
    },
  }), []);

  const chartData = useMemo(() => ({
    labels: data.map((d) => d.class_name),
    datasets: [
      {
        label: "Punctuality",
        data: data.map((d) => Math.round(d.punctuality_score)),
        backgroundColor: (context) => {
          const value = context.dataset.data[context.dataIndex];
          return value > 90 ? "#22c55e" : value > 75 ? "#f59e0b" : "#ef4444";
        },
        borderRadius: 6,
      },
    ],
  }), [data]);

  return (
    <figure className="h-full min-h-64">
      <figcaption className="sr-only">
        Class punctuality bar chart showing punctuality percentage for each class.
      </figcaption>
      <div role="img" aria-label={`Class punctuality chart: ${data.map(d => `${d.class_name}: ${Math.round(d.punctuality_score)}%`).join(", ")}`}>
        <Bar options={options} data={chartData} />
      </div>
    </figure>
  );
}

export default memo(ChartClass);
