import { QueryClient } from "@tanstack/react-query";
import { appQueryConfig, testQueryConfig } from "./queryConfig";

export const createAppQueryClient = () => new QueryClient(appQueryConfig);
export const createTestQueryClient = () => new QueryClient(testQueryConfig);
export const queryClient = createAppQueryClient();
