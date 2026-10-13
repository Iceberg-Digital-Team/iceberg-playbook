import { useCallback, useEffect, useState } from 'react';
import { canOpenAdminUsers } from '../appAccess';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader, StateMessage } from '../components/knowledge/ApplicationUI';
import '../components/knowledge/Knowledge.css';
import type { AdminAction } from '../services/adminUserRules';
import {
  createPasswordResetLink,
  disableUser,
  enableUser,
  listUsers,
  resendInvitation,
  revokeInvitation,
} from '../services/adminUserService';
import type { AdminSuggestion, CreatedLink, UserListRow } from '../services/adminUserService';
import {
  ChangeRoleDialog,
  ConfirmActionDialog,
  ErrorWithSuggestion,
  ExpiryLinkDialog,
  InviteUserDialog,
  LinkResultDialog,
} from './adminUsers/AdminDialogs';
import { buildRowView, confirmationFor, countActiveAdmins, presentError } from './adminUsersView';
import './AdminUsers.css';

type DialogState =
  | { type: 'invite' }
  | { type: 'link'; link: CreatedLink }
  | { type: 'role'; row: UserListRow }
  | { type: 'confirm'; row: UserListRow; action: 'disable_user' | 'revoke_invitation' }
  | { type: 'resend'; target: { id: string; name: string; email: string } }
  | { type: 'password-link'; target: { id: string; name: string; email: string } }
  | null;

export function AdminUsers() {
  const { session } = useAuth();
  if (!session || !canOpenAdminUsers(session.profile)) {
    return (
      <div className="editor admin-users-page">
        <StateMessage title="You do not have access to this page." action={<a href="#/">Back to Home</a>}>
          Only Admins can manage users.
        </StateMessage>
      </div>
    );
  }
  return <AdminUsersManager currentUserId={session.user.id} />;
}

function AdminUsersManager({ currentUserId }: { currentUserId: string }) {
  const [rows, setRows] = useState<UserListRow[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [reloadCount, setReloadCount] = useState(0);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState('');
  const [pageError, setPageError] = useState<ReturnType<typeof presentError> | null>(null);

  useEffect(() => {
    let active = true;
    listUsers()
      .then(items => {
        if (!active) return;
        setRows(items);
        setLoadError('');
      })
      .catch(err => {
        if (!active) return;
        setLoadError(presentError(err).message);
      });
    return () => {
      active = false;
    };
  }, [reloadCount]);

  const reload = useCallback(() => setReloadCount(count => count + 1), []);

  const finish = (message: string) => {
    setDialog(null);
    setNotice(message);
    reload();
  };

  const showLink = (link: CreatedLink) => {
    setDialog({ type: 'link', link });
    reload();
  };

  const targetFor = (id: string) => {
    const row = rows?.find(r => r.id === id);
    return { id, name: row?.fullName || row?.email || 'this user', email: row?.email || '' };
  };

  const runEnable = async (userId: string) => {
    setDialog(null);
    setPageError(null);
    setNotice('');
    try {
      await enableUser(userId);
      setNotice('User enabled.');
      reload();
    } catch (err) {
      setPageError(presentError(err));
    }
  };

  const onSuggestion = (suggestion: AdminSuggestion) => {
    if (suggestion.action === 'create_password_link') setDialog({ type: 'password-link', target: targetFor(suggestion.userId) });
    else if (suggestion.action === 'resend_invitation') setDialog({ type: 'resend', target: targetFor(suggestion.invitationId) });
    else void runEnable(suggestion.userId);
  };

  const onAction = (row: UserListRow, action: AdminAction) => {
    setNotice('');
    setPageError(null);
    const target = { id: row.id, name: row.fullName || row.email, email: row.email };
    switch (action) {
      case 'change_role': setDialog({ type: 'role', row }); break;
      case 'disable_user': setDialog({ type: 'confirm', row, action }); break;
      case 'revoke_invitation': setDialog({ type: 'confirm', row, action }); break;
      case 'enable_user': void runEnable(row.id); break;
      case 'resend_invitation': setDialog({ type: 'resend', target }); break;
      case 'create_password_link': setDialog({ type: 'password-link', target }); break;
    }
  };

  const ctx = { currentUserId, activeAdminCount: rows ? countActiveAdmins(rows) : 0 };
  const views = rows ? rows.map(row => ({ row, view: buildRowView(row, ctx) })) : [];

  return (
    <div className="editor admin-users-page">
      <PageHeader
        title="Users"
        description="Invite people, manage roles and access."
        action={<button type="button" className="btn-primary" onClick={() => { setNotice(''); setPageError(null); setDialog({ type: 'invite' }); }}>Invite user</button>}
      />

      {notice && <p role="status" className="helper-text">{notice}</p>}
      <ErrorWithSuggestion error={pageError} onSuggestion={onSuggestion} />

      {loadError ? (
        <StateMessage title="Could not load users." error action={<button type="button" className="btn-secondary" onClick={() => { setLoadError(''); setRows(null); reload(); }}>Try again</button>}>
          {loadError}
        </StateMessage>
      ) : !rows ? (
        <StateMessage title="Loading users…" />
      ) : rows.length === 0 ? (
        <StateMessage title="No users yet.">Invite the first user with “Invite user”.</StateMessage>
      ) : (
        <table className="admin-users-table">
          <caption className="admin-sr-only">Users and invitations</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
              <th scope="col">Role</th>
              <th scope="col">Status</th>
              <th scope="col">Expires</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {views.map(({ row, view }) => {
              const reasons = view.actions.filter(a => a.disabledReason);
              const reasonId = `admin-reasons-${view.key}`;
              return (
                <tr key={view.key}>
                  <td data-label="Name">{view.name}</td>
                  <td data-label="Email" className="admin-email">{view.email}</td>
                  <td data-label="Role">{view.role}</td>
                  <td data-label="Status">
                    <span className={`status-label admin-status admin-status-${view.status.kind}`}>{view.status.label}</span>
                  </td>
                  <td data-label="Expires">{view.expiresText}</td>
                  <td data-label="Actions">
                    <div className="admin-row-actions">
                      {view.actions.map(action => (
                        <button
                          key={action.action}
                          type="button"
                          className="btn-secondary"
                          disabled={!!action.disabledReason}
                          aria-describedby={action.disabledReason ? reasonId : undefined}
                          onClick={() => onAction(row, action.action)}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                    {reasons.length > 0 && (
                      <p className="helper-text admin-reasons" id={reasonId}>
                        {[...new Set(reasons.map(a => a.disabledReason))].join(' ')}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {dialog?.type === 'invite' && (
        <InviteUserDialog onClose={() => setDialog(null)} onCreated={showLink} onSuggestion={onSuggestion} />
      )}
      {dialog?.type === 'link' && <LinkResultDialog link={dialog.link} onClose={() => setDialog(null)} />}
      {dialog?.type === 'role' && (
        <ChangeRoleDialog row={dialog.row} onClose={() => setDialog(null)} onDone={() => finish('Role changed.')} />
      )}
      {dialog?.type === 'confirm' && (() => {
        const confirmation = confirmationFor(dialog.action, dialog.row);
        if (!confirmation) return null;
        const { row, action } = dialog;
        return (
          <ConfirmActionDialog
            confirmation={confirmation}
            run={() => (action === 'disable_user' ? disableUser(row.id) : revokeInvitation(row.id))}
            onClose={() => setDialog(null)}
            onDone={() => finish(action === 'disable_user' ? 'User disabled.' : 'Invitation revoked.')}
          />
        );
      })()}
      {dialog?.type === 'resend' && (
        <ExpiryLinkDialog
          title="Resend invitation"
          description="The old link stops working."
          target={dialog.target}
          run={expiresAt => resendInvitation(dialog.target.id, expiresAt)}
          onClose={() => setDialog(null)}
          onCreated={showLink}
          onSuggestion={onSuggestion}
        />
      )}
      {dialog?.type === 'password-link' && (
        <ExpiryLinkDialog
          title="Create password link"
          description="Older unused password links of this user stop working."
          target={dialog.target}
          run={expiresAt => createPasswordResetLink(dialog.target.id, expiresAt)}
          onClose={() => setDialog(null)}
          onCreated={showLink}
          onSuggestion={onSuggestion}
        />
      )}
    </div>
  );
}
