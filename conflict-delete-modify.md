# Delete vs Modify Conflict

Branch A (base) modified this file.
Branch B (PR) will delete it entirely.

This tests the delete/modify conflict scenario where the resolver must choose
between keeping the modified file or accepting the deletion.

modified_by = "branch-a"
important_data = "do not delete"
