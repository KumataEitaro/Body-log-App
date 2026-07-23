export interface HealthPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  requestAuthorization(): Promise<{ granted: boolean }>;
  readLatest(): Promise<{ weight?: number; bodyFat?: number; waist?: number; weightDate?: string; bodyFatDate?: string; waistDate?: string }>;
  readActiveEnergy(options: { date: string }): Promise<{ kcal: number }>;
  writeMetrics(options: { date: string; weight?: number; bodyFat?: number; waist?: number; energy?: number; protein?: number; fat?: number; carbs?: number }): Promise<{ written: number }>;
}
export declare const Health: HealthPlugin;
