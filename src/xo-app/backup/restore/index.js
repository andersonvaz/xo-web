import _, { messages } from 'intl'
import ActionButton from 'action-button'
import ActionRowButton from 'action-row-button'
import find from 'lodash/find'
import forEach from 'lodash/forEach'
import Link from 'link'
import map from 'lodash/map'
import moment from 'moment'
import orderBy from 'lodash/orderBy'
import React, { Component } from 'react'
import reduce from 'lodash/reduce'
import size from 'lodash/size'
import SortedTable from 'sorted-table'
import Tooltip from 'tooltip'
import Upgrade from 'xoa-upgrade'
import { confirm } from 'modal'
import { connectStore } from 'utils'
import { Container } from 'grid'
import { createGetObjectsOfType } from 'selectors'
import { FormattedDate, injectIntl } from 'react-intl'
import { info, error } from 'notification'
import { SelectPlainObject, Toggle } from 'form'
import { SelectSr } from 'select-objects'

import {
  importBackup,
  importDeltaBackup,
  isSrWritable,
  listRemote,
  startVm,
  subscribeRemotes
} from 'xo'

const parseDate = date => +moment(date, 'YYYYMMDDTHHmmssZ').format('x')

const isEmptyRemote = remote => !remote.backupInfoByVm || !size(remote.backupInfoByVm)

const backupOptionRenderer = backup => <span>
    {backup.type === 'delta' && <span><span className='tag tag-info'>{_('delta')}</span>{' '}</span>}
    {backup.tag}
    {' '}
  <FormattedDate value={new Date(backup.date)} month='long' day='numeric' year='numeric' hour='2-digit' minute='2-digit' second='2-digit' />
</span>

@connectStore(() => ({
  writableSrs: createGetObjectsOfType('SR').filter(
    [ isSrWritable ]
  ).sort()
}))
export default class Restore extends Component {
  constructor (props) {
    super(props)
    this.state = {
      remotes: []
    }
  }

  componentWillMount () {
    this.componentWillUnmount = subscribeRemotes(rawRemotes => {
      const { remotes } = this.state
      this.setState({
        remotes: orderBy(map(rawRemotes, r => {
          r = {...r}
          const older = find(remotes, {id: r.id})
          older && older.backupInfoByVm && (r.backupInfoByVm = older.backupInfoByVm)
          return r
        }), ['name'])
      })
    })
  }

  _list = async id => {
    const files = await listRemote(id)
    const { remotes } = this.state
    const remote = find(remotes, {id})
    if (remote) {
      const backupInfoByVm = {}
      forEach(files, file => {
        let backup
        const deltaInfo = /^vm_delta_(.*)_([^\/]+)\/([^_]+)_(.*)$/.exec(file)
        if (deltaInfo) {
          const [ , tag, id, date, name ] = deltaInfo
          backup = {
            type: 'delta',
            date: parseDate(date),
            id,
            name,
            path: file,
            tag,
            remoteId: remote.id
          }
        } else {
          const backupInfo = /^([^_]+)_([^_]+)_(.*)\.xva$/.exec(file)
          if (backupInfo) {
            const [ , date, tag, name ] = backupInfo
            backup = {
              type: 'simple',
              date: parseDate(date),
              name,
              path: file,
              tag,
              remoteId: remote.id
            }
          }
        }
        if (backup) {
          backupInfoByVm[backup.name] || (backupInfoByVm[backup.name] = [])
          backupInfoByVm[backup.name].push(backup)
        }
      })
      for (let vm in backupInfoByVm) {
        const bks = backupInfoByVm[vm]
        backupInfoByVm[vm] = {
          last: reduce(bks, (last, b) => b.date > last.date ? b : last),
          simpleCount: reduce(bks, (sum, b) => b.type === 'simple' ? ++sum : sum, 0),
          deltaCount: reduce(bks, (sum, b) => b.type === 'delta' ? ++sum : sum, 0)
        }
      }
      remote.backupInfoByVm = map(backupInfoByVm)
    }
    this.setState({remotes})
  }

  render () {
    const {
      remotes
    } = this.state

    return process.env.XOA_PLAN > 1
      ? <Container>
        <h2>{_('restoreBackups')}</h2>
        {!remotes.length && <span>{_('noRemotes')}</span>}
        {map(remotes, (r, key) =>
          <div key={key}>
            <Link to='/settings/remotes'>{r.name}</Link>
            {' '}
            {r.enabled && <span className='tag tag-success'>{_('remoteEnabled')}</span>}
            {r.error && <span className='tag tag-danger'>{_('remoteError')}</span>}
            <span className='pull-right'>
              <Tooltip content={_('displayBackup')}><ActionButton disabled={!r.enabled} icon='refresh' btnStyle='default' handler={this._list} handlerParam={r.id} /></Tooltip>
            </span>
            {r.backupInfoByVm && <div>
              <br />
              {isEmptyRemote(r)
                ? <span>{_('noBackup')}</span>
                : <SortedTable collection={r.backupInfoByVm} columns={BK_COLUMNS} />
              }
            </div>}
            <hr />
          </div>
        )}
      </Container>
      : <Container><Upgrade place='restoreBackup' available={2} /></Container>
  }
}

const openImportModal = backup => confirm({
  title: _('importBackupModalTitle', {name: backup.name}),
  body: <ImportModalBody vmName={backup.name} remoteId={backup.remoteId} />
}).then(doImport)

const doImport = ({ backup, remoteId, sr, start }) => {
  if (!sr || !backup) {
    error('Missing Parameters', 'Choose a SR and a backup')
    return
  }
  const importMethods = {
    delta: importDeltaBackup,
    simple: importBackup
  }
  notifyImportStart()
  try {
    const importPromise = importMethods[backup.type]({remote: remoteId, sr, file: backup.path}).then(id => {
      return id
    })
    if (start) {
      importPromise.then(id => startVm({id}))
    }
  } catch (err) {
    error('VM import', err.message || String(err))
  }
}

const BK_COLUMNS = [
  {
    name: _('backupVmNameColumn'),
    itemRenderer: info => info.last.name,
    sortCriteria: info => info.last.name
  },
  {
    name: _('backupTagColumn'),
    itemRenderer: info => info.last.tag,
    sortCriteria: info => info.last.tag
  },
  {
    name: _('lastBackupColumn'),
    itemRenderer: info => <span><FormattedDate value={info.last.date} month='long' day='numeric' year='numeric' hour='2-digit' minute='2-digit' second='2-digit' /> ({info.last.type})</span>,
    sortCriteria: info => info.last.date,
    sortOrder: 'desc'
  },
  {
    name: _('availableBackupsColumn'),
    itemRenderer: info => <span>
      {!!info.simpleCount && <span>{_('simpleBackup')} <span className='tag tag-pill tag-primary'>{info.simpleCount}</span></span>}
      {' '}
      {!!info.deltaCount && <span>{_('delta')} <span className='tag tag-pill tag-primary'>{info.deltaCount}</span></span>}
    </span>
  },
  {
    name: _('restoreColumn'),
    itemRenderer: info => <Tooltip content={_('restoreTip')}><ActionRowButton icon='menu-backup-restore' btnStyle='success' handler={openImportModal} handlerParam={info.last} /></Tooltip>
  }
]

const notifyImportStart = () => info(_('importBackupTitle'), _('importBackupMessage'))

@connectStore(() => ({
  writableSrs: createGetObjectsOfType('SR').filter(
    [ isSrWritable ]
  ).sort()
}), { withRef: true })
class _ModalBody extends Component {
  constructor (props) {
    super(props)
    this.state = {}
    const { vmName, remoteId } = props
    if (remoteId) {
      listRemote(remoteId)
        .then(files => {
          const options = []
          forEach(files, file => {
            let backup
            const deltaInfo = /^vm_delta_(.*)_([^\/]+)\/([^_]+)_(.*)$/.exec(file)
            if (deltaInfo) {
              const [ , tag, , date, name ] = deltaInfo
              if (name !== vmName) {
                return
              }
              backup = {
                type: 'delta',
                date: parseDate(date),
                path: file,
                tag
              }
            } else {
              const backupInfo = /^([^_]+)_([^_]+)_(.*)\.xva$/.exec(file)
              if (backupInfo) {
                const [ , date, tag, name ] = backupInfo
                if (name !== vmName) {
                  return
                }
                backup = {
                  type: 'simple',
                  date: parseDate(date),
                  path: file,
                  tag
                }
              }
            }
            options.push(backup)
          })
          this.setState({options})
        })
    }
  }

  get value () {
    const { sr, backup, start } = this.refs
    const { remoteId } = this.props
    return {
      sr: sr.value,
      backup: backup.value,
      start: start.value,
      remoteId
    }
  }

  render () {
    return <div>
      <SelectSr ref='sr' predicate={isSrWritable} />
      <br />
      <SelectPlainObject ref='backup' options={this.state.options} optionKey='path' optionRenderer={backupOptionRenderer} placeholder={this.props.intl.formatMessage(messages.importBackupModalSelectBackup)} />
      <br />
      <Toggle ref='start' /> {_('importBackupModalStart')}
    </div>
  }
}

const ImportModalBody = injectIntl(_ModalBody, {withRef: true})
