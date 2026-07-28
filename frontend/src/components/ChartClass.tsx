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
  type ChartData,
  type ChartOptions,
  type ScriptableContext,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

type ClassPunctuality = {
  class_name: string;
  punctuality_score: number;
};

type ChartClassProps = {
  data: ClassPunctuality[];
};

function ChartClass({ data }: ChartClassProps) {
  const options = useMemo<ChartOptions<'bar'>>(() => ({
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context) => ` ${String(context.raw)}% Punctuality`,
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

  const chartData = useMemo<ChartData<'bar', number[], string>>(() => ({
    labels: data.map((d) => d.class_name),
    datasets: [
      {
        label: "Punctuality",
        data: data.map((d) => Math.round(d.punctuality_score)),
        backgroundColor: (context: ScriptableContext<'bar'>) => {
          const value = Number(context.dataset.data[context.dataIndex]);
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
