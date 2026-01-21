
# 01/21
- Upon an edit:
  - We **only** update the concrete checkpoint & edit of the current file. 
  - We update the ambient Git state.  

- Every "so often":
  - We update the concrete checkpoints of the project.  


- Every "so so often":
  - We upload the changes to the remote. 



# 01/20
## Problems
- Can't tell locally if remote is public or private
- Squashed local commits will not be available in the remote 

```
workspace
  /.changes
    /local
    /commit-sha-1
    /commit-sha-2
    ...
    /commit-sha-n
```

Q:
- Which commit? Local or upstream? 


## Implementation 1: Full History
Goal: 
- Track all information needed to replay each edit with the same context 
  as the programmer. 

Naive Implementation:
- At each edit, check which files: 
  - Are not being tracked 
  - Have been modified  
- Save them

### Pros: 
- Will have git information, but it is not needed
- Full history is explicit (more reliable than edit-only)

### Cons
- Large .changes files.
- Long upload times. 


## Implementation 2: Edits Only
- Only track the history for files that are modified in VS code. 

### Pros: 
  - Minimal memory needed.

### Cons:
  - One needs to find the correct starting version.  
    - We will track git commits (local & remote)
  - Fewer fail-safes. E.g. suppose someone modifies a files from the command line 
    and not vscode. Then, there might be an inconsistent state until they  
    modify the file again. 



## Implementation 3: Git-Aided 
  - Example: 
    ```bash
    git diff --name-only <commit>
    ```



## Solution
-- If no git --> Track everything
-- If git (Attempt in order.. In order of commit resilience)
   - diff against upstream/main 
   - diff against upstream/master
   - diff against origin/main
   - diff against origin/master
   - (more????)
   - diff against HEAD
