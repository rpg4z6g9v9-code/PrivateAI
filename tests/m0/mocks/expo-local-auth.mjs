// Mock: expo-local-authentication
export async function hasHardwareAsync() { return false; }
export async function isEnrolledAsync() { return false; }
export async function authenticateAsync() { return { success: true }; }
