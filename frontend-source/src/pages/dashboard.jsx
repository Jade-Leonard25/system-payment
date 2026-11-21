import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Building2,
  Clock3,
  LayoutDashboard,
  LogOut,
  Settings,
  UserRound,
  UserRoundCheck,
  Users,
} from "lucide-react";
import {
  getStayLoggedIn,
  setStayLoggedIn as persistStayLoggedIn,
  signOut,
  useSession,
} from "../auth-client";
import {
  Avatar,
  AvatarFallback,
} from "../components/ui/avatar";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../components/ui/drawer";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "../components/ui/sidebar";
import { Switch } from "../components/ui/switch";
import { apiRequest } from "../api-client";

const SELECTED_COMPANY_KEY = "payroll_selected_company_id";

const getInitials = (name = "") =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "U";

const getLocalClock = () => {
  const now = new Date();
  return {
    logDate: [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-"),
    minutes: now.getHours() * 60 + now.getMinutes(),
  };
};

const getAttendanceLog = (entry) =>
  entry.attendance_logs ?? entry.attendanceLogs ?? entry;

const fetchCompanyAttendance = async (companyId) => {
  if (!companyId) return { employees: [], logs: [] };

  const [employeeResult, attendanceResult] = await Promise.all([
    apiRequest(`/api/employees/company/${encodeURIComponent(companyId)}`),
    apiRequest(`/api/attendance/company/${encodeURIComponent(companyId)}`),
  ]);
  return {
    employees: Array.isArray(employeeResult?.data) ? employeeResult.data : [],
    logs: Array.isArray(attendanceResult?.data) ? attendanceResult.data : [],
  };
};

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: session } = useSession();
  const [error, setError] = useState("");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stayLoggedIn, setStayLoggedIn] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [companyTaxId, setCompanyTaxId] = useState("");
  const [companyError, setCompanyError] = useState("");
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [companies, setCompanies] = useState([]);
  const [isLoadingCompanies, setIsLoadingCompanies] = useState(true);
  const [selectedCompanyId, setSelectedCompanyId] = useState(
    () => window.localStorage.getItem(SELECTED_COMPANY_KEY) || "",
  );
  const [rosterEmployees, setRosterEmployees] = useState([]);
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [loadedAttendanceCompanyId, setLoadedAttendanceCompanyId] = useState("");
  const [attendanceError, setAttendanceError] = useState("");
  const user = session?.user;
  const userName = user?.name || "Account";
  const userEmail = user?.email || "Email unavailable";
  const userRole = user?.role || "Role unavailable";
  const today = getLocalClock().logDate;
  const attendanceLoaded =
    Boolean(selectedCompanyId) &&
    loadedAttendanceCompanyId === selectedCompanyId;
  const activeEmployeeCount = rosterEmployees.filter(
    (employee) => employee.employmentStatus === "ACTIVE",
  ).length;
  const todayLogs = attendanceLoaded
    ? attendanceLogs
        .map(getAttendanceLog)
        .filter((log) => log.logDate === today)
    : [];
  const clockedInCount = new Set(
    todayLogs
      .filter((log) => log.timeOutMinutes === null)
      .map((log) => log.employeeId),
  ).size;
  const employeesWithAttendanceCount = new Set(
    todayLogs.map((log) => log.employeeId),
  ).size;

  useEffect(() => {
    let active = true;
    if (!selectedCompanyId) {
      return undefined;
    }

    fetchCompanyAttendance(selectedCompanyId)
      .then(({ employees: loadedEmployees, logs: loadedLogs }) => {
        if (!active) return;
        setRosterEmployees(loadedEmployees);
        setAttendanceLogs(loadedLogs);
        setAttendanceError("");
        setLoadedAttendanceCompanyId(selectedCompanyId);
      })
      .catch((loadError) => {
        if (active) {
          setAttendanceError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load employee attendance.",
          );
          setLoadedAttendanceCompanyId(selectedCompanyId);
        }
      })

    return () => {
      active = false;
    };
  }, [selectedCompanyId]);

  const handleCreateCompany = async (event) => {
    event.preventDefault();
    setCompanyError("");
    setIsCreatingCompany(true);

    try {
      const result = await apiRequest("/api/companies", {
        method: "POST",
        body: { name: companyName.trim(), taxId: companyTaxId.trim() },
      });
      if (!result?.data?.id) {
        throw new Error("The server did not return the new company ID.");
      }

      setCompanies((currentCompanies) => [
        ...currentCompanies,
        result.data,
      ]);
      window.localStorage.setItem(SELECTED_COMPANY_KEY, result.data.id);
      setSelectedCompanyId(result.data.id);
      setCompanyName("");
      setCompanyTaxId("");
      navigate("/createEmployees");
    } catch (createError) {
      setCompanyError(
        createError instanceof Error
          ? createError.message
          : "Could not create the company.",
      );
    } finally {
      setIsCreatingCompany(false);
    }
  };

  useEffect(() => {
    let active = true;
    getStayLoggedIn()
      .then((enabled) => {
        if (active) setStayLoggedIn(enabled);
      })
      .catch((settingsError) => {
        if (active) {
          setError(
            settingsError instanceof Error
              ? settingsError.message
              : "Could not load app settings.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const adminId = user?.id;
    if (!adminId) return undefined;

    let active = true;
    apiRequest(`/api/companies/admin/${encodeURIComponent(adminId)}`)
      .then((result) => {
        if (!active) return;
        const ownedCompanies = Array.isArray(result?.data) ? result.data : [];
        setCompanies(ownedCompanies);
        setIsLoadingCompanies(false);
        setCompanyError("");
        const savedCompanyId = window.localStorage.getItem(SELECTED_COMPANY_KEY);
        const initialCompanyId = ownedCompanies.some(
          (company) => company.id === savedCompanyId,
        )
          ? savedCompanyId
          : (ownedCompanies[0]?.id ?? "");
        setSelectedCompanyId(initialCompanyId);
        if (initialCompanyId) {
          window.localStorage.setItem(SELECTED_COMPANY_KEY, initialCompanyId);
        }
      })
      .catch((loadError) => {
        if (active) {
          setIsLoadingCompanies(false);
          setCompanyError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load your companies.",
          );
        }
      });

    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleStayLoggedInChange = async (enabled) => {
    setIsSavingSettings(true);
    setError("");
    try {
      await persistStayLoggedIn(enabled);
      setStayLoggedIn(enabled);
    } catch (settingsError) {
      setError(
        settingsError instanceof Error
          ? settingsError.message
          : "Could not save this setting.",
      );
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSignOut = async () => {
    setError("");
    setIsSigningOut(true);

    try {
      const result = await signOut();
      if (result.error) {
        setError(result.error.message || "Could not log out. Please try again.");
        return;
      }

      navigate("/login", { replace: true });
    } catch (signOutError) {
      setError(
        signOutError instanceof Error
          ? signOutError.message
          : "Could not log out. Please try again.",
      );
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <>
    <SidebarProvider className="h-full min-h-0 bg-background">
      <Sidebar collapsible="icon" variant="inset">
        <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border border-sidebar-border">
              <LayoutDashboard className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-semibold">Payroll</p>
              <p className="truncate text-xs text-muted-foreground">
                Admin workspace
              </p>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link to="/dashboard" />}
                    isActive={location.pathname === "/dashboard"}
                    tooltip="Dashboard"
                  >
                    <LayoutDashboard aria-hidden="true" />
                    <span>Dashboard</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    render={<Link to="/createEmployees" />}
                    isActive={location.pathname === "/createEmployees"}
                    tooltip="Employees"
                  >
                    <Users aria-hidden="true" />
                    <span>Employees</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
            <Avatar>
              <AvatarFallback>{getInitials(user?.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="truncate text-sm font-medium">{userName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {userRole}
              </p>
            </div>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="h-full min-h-0 bg-muted/30">
        <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
          <div className="flex items-center gap-3">
            <SidebarTrigger aria-label="Toggle sidebar" />
            <div>
              <p className="text-sm font-semibold">Dashboard</p>
              <p className="hidden text-xs text-muted-foreground sm:block">
                Workspace overview
              </p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Open account menu"
            >
              <div className="hidden min-w-0 text-right sm:block">
                <p className="max-w-40 truncate text-sm font-medium">
                  {userName}
                </p>
                <p className="max-w-40 truncate text-xs text-muted-foreground">
                  {userEmail}
                </p>
              </div>
              <Avatar>
                <AvatarFallback>{getInitials(user?.name)}</AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="flex items-center gap-3 py-1">
                    <Avatar>
                      <AvatarFallback>{getInitials(user?.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{userName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {userEmail}
                      </p>
                    </div>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <UserRound aria-hidden="true" />
                <span>Role: {userRole}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <Settings aria-hidden="true" />
                <span>Settings</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isSigningOut}
                onClick={handleSignOut}
              >
                <LogOut aria-hidden="true" />
                <span>{isSigningOut ? "Logging out…" : "Log out"}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="min-h-0 flex-1 space-y-6 overflow-auto p-4 md:p-6">
          {error && (
            <p
              role="alert"
              className="rounded-lg border bg-background px-4 py-3 text-sm"
            >
              {error}
            </p>
          )}

          <section className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                Company overview
              </h1>
              <p className="text-sm text-muted-foreground">
                Welcome, {userName}. Here is your payroll and attendance at a
                glance.
              </p>
            </div>
            <label className="grid min-w-56 gap-1 text-sm font-medium">
              Company
              <select
                value={selectedCompanyId}
                onChange={(event) => {
                  const companyId = event.target.value;
                  setSelectedCompanyId(companyId);
                  setAttendanceError("");
                  if (companyId) {
                    window.localStorage.setItem(SELECTED_COMPANY_KEY, companyId);
                  } else {
                    window.localStorage.removeItem(SELECTED_COMPANY_KEY);
                  }
                }}
                disabled={isLoadingCompanies || companies.length === 0}
                className="h-10 rounded-md border bg-background px-3 font-normal"
              >
                {companies.length ? (
                  companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {isLoadingCompanies ? "Loading companies…" : "No company yet"}
                  </option>
                )}
              </select>
            </label>
          </section>

          <section
            aria-label="Financial summary"
            className="space-y-3"
          >
            <div>
              <h2 className="font-medium">Financial summary</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Financial balances will appear when ledger and billing records
                are available.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ["Cash on hand & bank", "Ledger data not connected"],
                ["Accounts receivable", "Invoice data not connected"],
                ["Accounts payable", "Expense data not connected"],
                ["Net income (MTD / YTD)", "Posted ledger data not connected"],
              ].map(([label, detail]) => (
                <article
                  className="rounded-xl border border-dashed bg-background p-5"
                  key={label}
                >
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="mt-3 text-2xl font-semibold text-muted-foreground">
                    —
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section
            aria-label="Company payroll overview"
            className="space-y-3"
          >
            <div>
              <h2 className="font-medium">Payroll operations</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Live counts from the selected company’s employee and attendance
                records.
              </p>
            </div>
            {attendanceError && (
              <p role="alert" className="text-sm text-destructive">
                Could not load payroll attendance: {attendanceError}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border bg-background p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Companies</p>
                <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {isLoadingCompanies ? "—" : companies.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Available in your workspace
              </p>
            </article>
            <article className="rounded-xl border bg-background p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">Active employees</p>
                <Users className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {attendanceLoaded ? activeEmployeeCount : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {attendanceLoaded
                  ? `Of ${rosterEmployees.length} employees in this company`
                  : selectedCompanyId
                    ? "Loading company roster…"
                    : "Select or create a company"}
              </p>
            </article>
            <article className="rounded-xl border bg-background p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">On shift today</p>
                <Clock3 className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {attendanceLoaded ? clockedInCount : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Employees with an open attendance record
              </p>
            </article>
            <article className="rounded-xl border bg-background p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Attendance recorded today
                </p>
                <UserRoundCheck className="size-4 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-semibold tabular-nums">
                {attendanceLoaded ? employeesWithAttendanceCount : "—"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Unique employees with today’s time log
              </p>
            </article>
            </div>
          </section>

          <section className="rounded-xl border bg-background p-5">
            <div className="mb-4">
              <h2 className="font-medium">Create a company</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a company first so employee records can be saved to its
                payroll roster.
              </p>
            </div>
            <form
              onSubmit={handleCreateCompany}
              className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            >
              <label className="grid gap-2 text-sm font-medium">
                Company name
                <input
                  required
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  className="h-10 rounded-md border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Company name"
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                Tax ID
                <input
                  required
                  value={companyTaxId}
                  onChange={(event) => setCompanyTaxId(event.target.value)}
                  className="h-10 rounded-md border bg-background px-3 font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Company tax ID"
                />
              </label>
              <Button type="submit" disabled={isCreatingCompany}>
                {isCreatingCompany ? "Creating…" : "Create company"}
              </Button>
            </form>
            {companyError && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {companyError}
              </p>
            )}
          </section>

          <section className="rounded-xl border bg-background p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-medium">Employee roster</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create and edit employee records in a spreadsheet.
                </p>
              </div>
              <Button render={<Link to="/createEmployees" />} nativeButton={false}>
                <Users aria-hidden="true" />
                Create employees
              </Button>
            </div>
          </section>

          <Button
            type="button"
            variant="outline"
            className="sm:hidden"
            disabled={isSigningOut}
            onClick={handleSignOut}
          >
            <LogOut aria-hidden="true" />
            {isSigningOut ? "Logging out…" : "Log out"}
          </Button>
        </main>
      </SidebarInset>
    </SidebarProvider>
    <Drawer open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="mx-auto w-full max-w-2xl">
          <DrawerTitle>Settings</DrawerTitle>
          <DrawerDescription>
            Choose how this app handles your account and future features.
          </DrawerDescription>
        </DrawerHeader>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 overflow-y-auto p-4 pb-8">
          <section className="space-y-4">
            <h2 className="text-sm font-medium">Sign-in</h2>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Stay logged in</p>
                <p className="text-sm text-muted-foreground">
                  Keep your account signed in when you close and reopen this app.
                </p>
              </div>
              <Switch
                checked={stayLoggedIn}
                onCheckedChange={handleStayLoggedInChange}
                disabled={isSavingSettings}
                aria-label="Stay logged in"
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">Log out when app closes</p>
                <p className="text-sm text-muted-foreground">
                  Sign out automatically instead of keeping your session.
                </p>
              </div>
              <Switch
                checked={!stayLoggedIn}
                onCheckedChange={(enabled) =>
                  handleStayLoggedInChange(!enabled)
                }
                disabled={isSavingSettings}
                aria-label="Log out when app closes"
              />
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-sm font-medium">Coming later</h2>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4 opacity-60">
              <div>
                <p className="text-sm font-medium">
                  Always ask for password in other applications
                </p>
                <p className="text-sm text-muted-foreground">
                  This setting is not available yet.
                </p>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label="Always ask for password in other applications"
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4 opacity-60">
              <div>
                <p className="text-sm font-medium">Automatic sync</p>
                <p className="text-sm text-muted-foreground">
                  This setting is not available yet.
                </p>
              </div>
              <Switch
                checked={false}
                disabled
                aria-label="Automatic sync"
              />
            </div>
          </section>
          {isSavingSettings && (
            <p role="status" className="text-sm text-muted-foreground">
              Saving settings…
            </p>
          )}
        </div>
      </DrawerContent>
    </Drawer>
    </>
  );
}
