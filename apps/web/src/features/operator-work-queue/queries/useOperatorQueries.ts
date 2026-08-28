import { queryOptions, useQuery } from "@tanstack/react-query";
import { fetchOperatorWorkQueue } from "../api/operator";
import { queryKeys } from "../../../lib/query/queryKeys";

export const operatorWorkQueueOptions = () => queryOptions({
  queryKey: queryKeys.operator.workQueue,
  queryFn: ({ signal }) => fetchOperatorWorkQueue(signal),
});

export const useOperatorWorkQueueQuery = () => useQuery(operatorWorkQueueOptions());
