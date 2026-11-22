import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { apiRequest } from "../api-client";
import {
  Banknote,
  BookOpen,
  Building2,
  ChevronDown,
  ClipboardList,
  FileClock,
  LayoutDashboard,
  Search,
  ReceiptText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import accountingWorkspaceLogo from "../assets/accounting-workspace-logo.svg";
import { Avatar, AvatarFallback } from "./ui/avatar";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./ui/sidebar";

const primaryModules = [
  { label: "Overview", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", detail: "Journal, Chart of Accounts", Icon: BookOpen },
  { label: "Sales & Receivables", href: "/sales", Icon: ReceiptText },
  { label: "Purchases & Payables", Icon: Wallet },
  { label: "Banking", detail: "Reconciliation", Icon: Banknote },
  {
    label: "Payroll & Employees",
    href: "/createEmployees",
    Icon: Users,
  },
  { label: "Reports", Icon: ClipboardList },
  { label: "Compliance center", Icon: Building2 },
  { label: "Audit log", href: "/audit", Icon: FileClock },
];

const moreModules = [
  { label: "Import history", Icon: FileClock },
  { label: "Recurring transactions", Icon: ReceiptText },
];

function getInitials(name = "") {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "U"
  );
}

export default function AppSidebar({
  user,
  activePath,
  onSettingsClick,
  companies = [],
  selectedCompanyId = "",
  onCompanyChange,
  isLoadingCompanies = false,
  canViewAudit,
  canViewSales,
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [auditAccess, setAuditAccess] = useState({ companyId: "", allowed: false });
  const navigate = useNavigate();
  const userName = user?.name || "Account";
  const hasAuditPermission =
    canViewAudit ??
    (auditAccess.companyId === selectedCompanyId && auditAccess.allowed);
  const visiblePrimaryModules = primaryModules.filter(
    (item) =>
      (item.href !== "/audit" || hasAuditPermission) &&
      (item.href !== "/sales" || canViewSales === true),
  );

  useEffect(() => {
    let active = true;
    if (!selectedCompanyId || canViewAudit !== undefined) return undefined;
    const query = new URLSearchParams({ companyId: selectedCompanyId });
    apiRequest(`/api/audit/access?${query}`)
      .then((result) => {
        if (active) {
          setAuditAccess({
            companyId: selectedCompanyId,
            allowed: result?.allowed === true,
          });
        }
      })
      .catch(() => {
        if (active) setAuditAccess({ companyId: selectedCompanyId, allowed: false });
      });
    return () => {
      active = false;
    };
  }, [canViewAudit, selectedCompanyId]);

  useEffect(() => {
    const handleSearchShortcut = (event) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, []);

  const selectModule = (item) => {
    if (item.href) {
      navigate(item.href);
      setSearchOpen(false);
    }
  };

  return (
    <>
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <div className="flex items-center gap-3">
          <img
            src={accountingWorkspaceLogo}
            className="size-9 shrink-0 rounded-lg"
            alt=""
            aria-hidden="true"
          />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-semibold">Payroll</p>
            <p className="truncate text-xs text-muted-foreground">
              Accounting workspace
            </p>
          </div>
        </div>
        <div className="mt-3 space-y-2 group-data-[collapsible=icon]:hidden">
          <label
            htmlFor="sidebar-company-switcher"
            className="text-xs font-medium text-muted-foreground"
          >
            Company
          </label>
          <select
            id="sidebar-company-switcher"
            value={selectedCompanyId}
            onChange={(event) => onCompanyChange?.(event.target.value)}
            disabled={isLoadingCompanies || companies.length === 0}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm font-normal"
            aria-label="Select company"
          >
            {companies.length ? (
              companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))
            ) : (
              <option value="">
                {isLoadingCompanies ? "Loading companies…" : "No company available"}
              </option>
            )}
          </select>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="flex items-center justify-between">
            <span>Workspace</span>
            <span className="text-[10px] font-normal text-muted-foreground">
              {visiblePrimaryModules.length}
            </span>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setSearchOpen(true)}
                  tooltip="Search (Ctrl+K)"
                  aria-label="Search navigation (Control or Command K)"
                >
                  <Search aria-hidden="true" />
                  <span>Search</span>
                  <kbd className="ml-auto rounded border px-1 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                    Ctrl K
                  </kbd>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {visiblePrimaryModules.map((item) => {
                const { label, href, Icon, detail } = item;
                return (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      {...(href
                        ? {
                            render: <Link to={href} />,
                            isActive: activePath === href,
                          }
                        : { disabled: true, "aria-label": `${label}, coming soon` })}
                      tooltip={href ? label : `${label} (coming soon)`}
                    >
                      <Icon aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
                        <span className="truncate">{label}</span>
                        {detail && (
                          <span className="truncate text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                            ({detail})
                          </span>
                        )}
                      </span>
                      {!href && (
                        <span className="ml-auto text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                          Soon
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
              <SidebarMenu>
                <SidebarMenuItem>
                  <CollapsibleTrigger
                    render={
                      <SidebarMenuButton
                        aria-expanded={moreOpen}
                        tooltip="More"
                      />
                    }
                  >
                    <ChevronDown
                      aria-hidden="true"
                      className={`transition-transform ${moreOpen ? "rotate-180" : ""}`}
                    />
                    <span>More</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SidebarMenu className="mt-1 pl-3">
                      {moreModules
                        .map(({ label, Icon }) => (
                          <SidebarMenuItem key={label}>
                            <SidebarMenuButton
                              disabled
                              aria-label={`${label}, coming soon`}
                              tooltip={`${label} (coming soon)`}
                            >
                              <Icon aria-hidden="true" />
                              <span>{label}</span>
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        ))}
                    </SidebarMenu>
                  </CollapsibleContent>
                </SidebarMenuItem>
              </SidebarMenu>
            </Collapsible>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onSettingsClick}
              tooltip="Settings: users, roles, entities, tax"
              aria-label="Open settings for users, roles, entities, and tax"
            >
              <Settings aria-hidden="true" />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
                <span>Settings</span>
                <span className="truncate text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                  (users, roles, entities, tax)
                </span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mt-2 flex items-center gap-3 group-data-[collapsible=icon]:justify-center">
          <Avatar>
            <AvatarFallback>{getInitials(user?.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-medium">{userName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user?.role || "Account"}
            </p>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
    <CommandDialog
      open={searchOpen}
      onOpenChange={setSearchOpen}
      title="Search payroll"
      description="Search and navigate to an accounting workspace."
    >
      <Command>
        <CommandInput placeholder="Search modules…" />
        <CommandList>
          <CommandEmpty>No matching modules.</CommandEmpty>
          <CommandGroup heading="Workspace">
            {visiblePrimaryModules.map((item) => (
              <CommandItem
                key={item.label}
                value={`${item.label} ${item.detail ?? ""}`}
                disabled={!item.href}
                onSelect={() => selectModule(item)}
              >
                <item.Icon aria-hidden="true" />
                <span>{item.label}</span>
                {!item.href && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    Coming soon
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="More">
            {moreModules.map((item) => (
              <CommandItem key={item.label} value={item.label} disabled>
                <item.Icon aria-hidden="true" />
                <span>{item.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  Coming soon
                </span>
              </CommandItem>
            ))}
            <CommandItem
              value="Settings users roles entities tax"
              onSelect={() => {
                setSearchOpen(false);
                onSettingsClick?.();
              }}
            >
              <Settings aria-hidden="true" />
              <span>Settings</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
    </>
  );
}
