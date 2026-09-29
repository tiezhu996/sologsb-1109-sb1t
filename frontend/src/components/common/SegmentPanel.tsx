import { Button, Empty, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ProcessBatch, ProcessSegment } from '../../types/process-batch';
import { allConfirmed, totalDuration } from '../../utils/segment';

const { Text } = Typography;

export interface SegmentPanelProps {
  batch: ProcessBatch;
  /** 确认当前待接班段 */
  onConfirmSegment: (segment: ProcessSegment) => void;
  /** 接续一段（需上一段已确认） */
  onAddSegment: () => void;
  /** 全部段确认后完工判定（录最终重量、判得率与程度） */
  onFinalize: () => void;
}

/** 工序分段明细：班组、锅温、时长、交接说明与接班确认状态 */
export default function SegmentPanel({ batch, onConfirmSegment, onAddSegment, onFinalize }: SegmentPanelProps) {
  const confirmedAll = allConfirmed(batch);
  const total = totalDuration(batch);

  const columns: TableColumnsType<ProcessSegment> = [
    { title: '段次', dataIndex: 'seq', width: 56, align: 'center', render: (v: number) => `第${v}段` },
    {
      title: '作业班组',
      dataIndex: 'team',
      width: 90,
      render: (team: string) => <Tag color="geekblue">{team}</Tag>,
    },
    { title: '锅温(℃)', dataIndex: 'temp', width: 80, align: 'right' },
    { title: '时长(min)', dataIndex: 'durationMin', width: 90, align: 'right' },
    {
      title: '交接说明',
      dataIndex: 'handoverNote',
      render: (v: string) => (v ? <Text>{v}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: '接班确认',
      width: 220,
      render: (_, seg) =>
        seg.status === '已确认' ? (
          <Space size={4} direction="vertical" style={{ lineHeight: 1.4 }}>
            <Tag color="green">已确认 · {seg.confirmedBy ?? '接班班组'}</Tag>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {seg.confirmedAt ? new Date(seg.confirmedAt).toLocaleString('zh-CN', { hour12: false }) : ''}
            </Text>
          </Space>
        ) : (
          <Space size={4} direction="vertical" style={{ lineHeight: 1.4 }}>
            <Tag color="orange">待接班确认{seg.nextTeam ? ` · ${seg.nextTeam}` : ''}</Tag>
            {!batch.locked && !batch.finalized ? (
              <Button size="small" type="link" style={{ padding: 0 }} onClick={() => onConfirmSegment(seg)}>
                {seg.nextTeam ? `${seg.nextTeam}接班确认` : '接班确认'}
              </Button>
            ) : null}
          </Space>
        ),
    },
  ];

  return (
    <div style={{ background: '#fafbfa', padding: '8px 12px', borderRadius: 8 }}>
      <Space style={{ marginBottom: 8 }} wrap>
        <Text type="secondary">共 {batch.segments.length} 段</Text>
        <Text strong>累计时长 {total} min</Text>
        {confirmedAll ? <Tag color="green">全部段已确认</Tag> : <Tag color="orange">尚有段等待接班确认</Tag>}
        {batch.finalized ? (
          <Text type="secondary">
            最终重量 {batch.outputKg ?? '-'} kg · 得率 {batch.yieldRate ?? '-'}%
          </Text>
        ) : null}
      </Space>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={batch.segments}
        pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分段" /> }}
      />
      {!batch.locked && !batch.finalized ? (
        <Space style={{ marginTop: 8 }} wrap>
          {confirmedAll ? (
            <>
              <Button size="small" onClick={onAddSegment}>
                下一班接续一段
              </Button>
              <Button size="small" type="primary" onClick={onFinalize}>
                录入最终重量并判定
              </Button>
            </>
          ) : (
            <Button size="small" disabled title="需待接班段经下一班确认后才能继续">
              下一班确认后才能继续加段
            </Button>
          )}
        </Space>
      ) : null}
    </div>
  );
}
