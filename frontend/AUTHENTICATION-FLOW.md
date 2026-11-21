# Product Key & Admin Access

## App startup

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"20px"},"flowchart":{"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TD
    A([Open app]) --> B{Already signed in?}
    B -- Yes --> D([Dashboard])
    B -- No --> C{Admin registered?}
    C -- Yes --> L[Admin login]
    C -- No --> K[Activate product key]

    classDef startEnd fill:#ecfdf5,stroke:#059669,color:#064e3b,stroke-width:2px
    classDef decision fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px
    classDef action fill:#eef2ff,stroke:#6366f1,color:#312e81
    class A,D startEnd
    class B,C decision
    class L,K action
```

## First-time admin setup

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"20px"},"flowchart":{"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TD
    K[Enter 9-character product key] --> V{Key accepted?}
    V -- No --> KE[Show key error]
    KE --> K
    V -- Yes --> R[Register admin name, email, and password]
    R --> S{Account created?}
    S -- No --> RE[Show registration error]
    RE --> R
    S -- Yes --> I[Sign in automatically]
    I --> OK([Dashboard])
    I -. Sign-in failed .-> L[Continue at admin login]

    classDef action fill:#eef2ff,stroke:#6366f1,color:#312e81
    classDef decision fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px
    classDef error fill:#fff1f2,stroke:#e11d48,color:#881337
    classDef success fill:#ecfdf5,stroke:#059669,color:#064e3b,stroke-width:2px
    class K,R,I,L action
    class V,S decision
    class KE,RE error
    class OK success
```

## Returning admin

```mermaid
%%{init: {"theme":"base","themeVariables":{"fontSize":"20px"},"flowchart":{"nodeSpacing":36,"rankSpacing":44}}}%%
flowchart TD
    L[Enter email and password] --> V{Credentials accepted?}
    V -- No --> E[Show login error]
    E --> L
    V -- Yes --> D([Dashboard])
    D --> O[Explicit logout]
    O --> L

    classDef action fill:#f0fdfa,stroke:#0d9488,color:#134e4a
    classDef decision fill:#fff7ed,stroke:#ea580c,color:#7c2d12,stroke-width:2px
    classDef error fill:#fff1f2,stroke:#e11d48,color:#881337
    classDef success fill:#ecfdf5,stroke:#059669,color:#064e3b,stroke-width:2px
    class L,O action
    class V decision
    class E error
    class D success
```

Product-key activation is for the initial admin setup only. Returning admins
use `/login`; the **Stay logged in** setting controls the `rememberMe` value
sent during sign-in.
